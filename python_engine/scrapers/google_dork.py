"""
Site-dork scraper — a thin wrapper over the pluggable search-backend layer.

Builds a `site:<domain> "<keyword>"` query and runs it through search_backends
(Serper → Brave → Google CSE → SearXNG → DDG → Mojeek). When every available
backend is throttled it raises AllBackendsThrottled so the orchestrator can show
the "rate-limited, cooling down" dialog instead of returning silent zeros.
"""

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from typing import List, Dict, Optional
import logging

from .search_backends import web_search, AllBackendsThrottled  # noqa: F401 (re-exported)
from .intent_dorks import expand_keyword_to_dorks
from .dateparse import parse_date, within_freshness, freshness_label, recency_key

logger = logging.getLogger(__name__)


# ── Lead-quality filter ───────────────────────────────────────────────────────
# Junk URL fragments that mean "aggregator / hub / auth page", not a real lead.
_JUNK_URL_ANY = (
    "/login", "/signup", "/register", "/help/", "/about", "/terms",
    "/privacy", "/legal", "/careers", "/advertise", "/sitemap",
)
_JUNK_URL_BY_DOMAIN = {
    "linkedin.com": ("/directory/", "/learning/", "/pulse/topics", "/cur/", "/games/"),
    "quora.com": ("/profile/", "/topic/", "/qemail/"),
    "instagram.com": ("/explore/", "/reels/audio/"),
    "facebook.com": ("/watch/", "/hashtag/", "/marketplace/"),
    "upwork.com": ("/freelancers/", "/hire/", "/services/"),
    "justdial.com": ("/list/", "/top-", "/best-"),
    "indiamart.com": ("/impcat/", "/proddetail/search"),
}
# Title patterns that signal an aggregation page rather than a single lead.
_JUNK_TITLE_RE = re.compile(
    r"(^\d[\d,]*\s+.*\bjobs?\b)"          # "58 Marketing Agency jobs in ..."
    r"|(\btop\s+\d+\b)"                    # "Top 10 ..."
    r"|(\bbest\s+\d+\b)"                   # "Best 20 ..."
    r"|(\bjobs?\s+in\b.*\|)"              # "... Jobs in X | LinkedIn"
    r"|(^\s*(login|sign in|log in)\b)",
    re.IGNORECASE,
)


def _is_junk_lead(site_domain: str, url: str, title: str) -> bool:
    low = url.lower()
    if any(frag in low for frag in _JUNK_URL_ANY):
        return True
    for frag in _JUNK_URL_BY_DOMAIN.get(site_domain, ()):
        if frag in low:
            return True
    # LinkedIn job *search* pages are noise; a specific posting (/jobs/view/…) is a lead.
    if site_domain == "linkedin.com" and "/jobs/" in low and "/jobs/view/" not in low:
        return True
    if title and _JUNK_TITLE_RE.search(title):
        return True
    return False


def _canonical(url: str) -> str:
    """Normalise a URL for de-duplication: drop scheme/query/fragment + trailing slash."""
    u = url.split("#", 1)[0].split("?", 1)[0]
    u = u.replace("https://", "").replace("http://", "").replace("www.", "")
    return u.rstrip("/").lower()


# Words a search engine bolts onto a title as a breadcrumb/suffix, not a name.
_TITLE_SEPARATORS = (" - ", " | ", " • ", " · ", " › ", " — ", " :: ")


def _name_from_slug(url: str) -> str:
    """Derive a human name from the last meaningful URL path segment.
    e.g. .../company/fx-retina-digital-marketing-agency → 'Fx Retina Digital Marketing Agency'."""
    path = url.split("#", 1)[0].split("?", 1)[0].rstrip("/")
    segs = [s for s in path.split("/") if s]
    # Skip domain + generic containers to reach the identifying slug.
    skip = {"company", "in", "posts", "pub", "profile", "q", "jobs", "view",
            "school", "showcase", "groups", "p", "reel", "status"}
    slug = ""
    for seg in reversed(segs):
        if "." in seg or seg.lower() in skip or seg.isdigit():
            continue
        slug = seg
        break
    slug = re.sub(r"[-_]+", " ", slug)
    slug = re.sub(r"\b\d{4,}\b", "", slug)          # strip long id numbers
    slug = re.sub(r"\s+", " ", slug).strip()
    return slug.title() if slug else ""


def _derive_name(title: str, url: str, site_domain: str) -> str:
    """Best clean display name: prefer a real title, fall back to the URL slug when
    the engine only gave us a breadcrumb like 'Linkedin https://… › company › …'."""
    t = title.strip()
    # Cut at the first breadcrumb/suffix separator.
    for sep in _TITLE_SEPARATORS:
        if sep in t:
            t = t.split(sep, 1)[0].strip()
            break
    low = t.lower()
    brand = site_domain.split(".")[0].lower()
    looks_bad = (
        not t
        or "http" in low
        or "›" in title or "»" in title
        or low in (brand, brand + " ", "linkedin", "quora", "justdial", "indiamart")
        or len(t) < 3
    )
    if looks_bad:
        slug_name = _name_from_slug(url)
        if slug_name:
            return slug_name
    return t or _name_from_slug(url) or "Unknown"


def _dork_sync(platform_name: str, site_domain: str, keyword: str, limit: int,
               search_mode: str = "auto", freshness: Optional[str] = None) -> List[Dict]:
    dorks = expand_keyword_to_dorks(platform_name, site_domain, keyword)

    leads: List[Dict] = []
    seen: set = set()
    # When a freshness window is set we may drop stale hits, so cast a wider net
    # per query to still fill `limit` with fresh ones.
    fetch_n = limit * 3 if freshness else limit

    for query in dorks:
        if len(leads) >= limit:
            break

        # Freshness rides into the search layer → Serper asks Google for recent
        # results only (qdr:h/d/w…), so we surface hours-old posts, not archives.
        results = web_search(query, fetch_n, search_mode, freshness)  # may raise AllBackendsThrottled

        for r in results:
            if len(leads) >= limit:
                break
            href = r.get("url", "")
            # Keep only genuine links to the target domain.
            if not href or site_domain not in href:
                continue
            canon = _canonical(href)
            if canon in seen:
                continue

            title = (r.get("title") or "").strip()
            if not title:
                continue
            # Drop aggregator/hub/auth pages — they aren't real, contactable leads.
            if _is_junk_lead(site_domain, href, title):
                logger.debug("Filtered junk lead: %s (%s)", title[:40], href)
                continue

            # Real recency from the engine's own date field ("2 hours ago" /
            # "Mar 3, 2026"), NOT the scrape time. This is the freshness signal.
            posted_iso, age_hours = parse_date(r.get("date", ""))
            # Hard-drop stale leads when a window is requested and we KNOW the age.
            # Undated leads survive (we rank them below dated ones, never discard).
            if freshness and not within_freshness(age_hours, freshness):
                continue

            seen.add(canon)
            snippet = (r.get("snippet") or "").strip()
            clean_name = _derive_name(title, href, site_domain)
            scraped_now = datetime.now(timezone.utc).isoformat()
            leads.append({
                # Stable id from the URL — never Python's per-process-randomized hash().
                "external_id": f"{platform_name}_{hashlib.sha1(href.encode()).hexdigest()[:16]}",
                "name": clean_name,
                "author": clean_name,
                "website": href,
                "post_url": href,
                "title": title,
                "platform": platform_name,
                "kind": "post",
                "about_snippet": snippet,
                "post_content": snippet,
                "category": "Social Post",
                "address": platform_name.capitalize(),
                "phone": "",
                "rating": "N/A",
                "reviews": "N/A",
                "matched_keyword": keyword,
                "created_at": posted_iso or scraped_now,
                "posted_at": posted_iso or "",   # empty = unknown age (not "now")
                "age_hours": age_hours,
                "freshness_label": freshness_label(age_hours),
            })

    # Freshest first — hours-old comments float to the top of the pile.
    leads.sort(key=recency_key)
    if not leads:
        logger.info("Dork for %s ('%s', freshness=%s) found 0 results",
                    platform_name, keyword, freshness or "any")
    return leads


async def scrape_google_dork(platform_name: str, site_domain: str, keyword: str, limit: int = 10,
                             search_mode: str = "auto", freshness: Optional[str] = None) -> List[Dict]:
    """Async wrapper — runs the blocking HTTP+parse off the event loop.

    Propagates AllBackendsThrottled to the caller so a cooldown dialog can fire.
    """
    leads = await asyncio.to_thread(_dork_sync, platform_name, site_domain, keyword, limit, search_mode, freshness)
    
    if leads:
        try:
            from .enrichment import enrich_leads
            top_leads = leads[:4]
            rest_leads = leads[4:]
            enriched = await enrich_leads(top_leads)
            leads = enriched + rest_leads
        except Exception as e:
            logger.error(f"Error during lead enrichment: {e}")

    return leads
