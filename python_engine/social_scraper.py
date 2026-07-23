import asyncio
import logging
from typing import List, Dict

from scrapers.reddit import scrape_reddit
from scrapers.hackernews import scrape_hackernews
from scrapers.devto import scrape_devto
from scrapers.stackoverflow import scrape_stackoverflow
from scrapers.google_dork import scrape_google_dork
from scrapers.producthunt import scrape_producthunt
from scrapers.x import scrape_x
from scrapers.darkweb import scrape_darkweb
from scrapers.search_backends import AllBackendsThrottled

logger = logging.getLogger(__name__)

# A dork platform → its site domain. ProductHunt has a native API path and is
# handled separately; it stays here only for its dork fallback domain.
DORK_SITES = {
    "linkedin": "linkedin.com",
    "instagram": "instagram.com",
    "facebook": "facebook.com",
    "quora": "quora.com",
    "upwork": "upwork.com",
    # Indian B2B directories — best-effort via `site:` search. Yields business
    # name + listing URL; deep fields (revealed phone) need native scraping,
    # tracked as a future enhancement.
    "indiamart": "indiamart.com",
    "justdial": "justdial.com",
}

# What "all" expands to — a fast, mostly-reliable spread.
ALL_PLATFORMS = ["reddit", "x", "hackernews", "devto", "stackoverflow", "linkedin", "darkweb"]

# Friendly platform labels for the rate-limit dialog.
PLATFORM_LABELS = {
    "x": "X / Twitter", "linkedin": "LinkedIn", "instagram": "Instagram",
    "facebook": "Facebook",
    "quora": "Quora", "producthunt": "ProductHunt", "upwork": "Upwork", "reddit": "Reddit",
    "darkweb": "Dark Web / Tor", "indiamart": "IndiaMART", "justdial": "Justdial",
}


async def _scrape_one(platform: str, keyword: str, n: int, search_mode: str = "auto",
                      freshness=None) -> List[Dict]:
    """Run a single platform scraper and return its raw leads.

    `freshness` ('h'/'d'/'w'/'m'/'y' or None) is threaded to every scraper that
    can honour it natively (Reddit `t`, HN window, Serper qdr: for dorks). The
    rest are still recency-sorted downstream.

    May raise AllBackendsThrottled when the scrape-tier search layer is fully
    rate-limited — the orchestrator turns that into a user-facing cooldown notice.
    """
    if platform in ("x", "twitter"):
        return await scrape_x(keyword, max_leads=n)
    if platform == "reddit":
        return await scrape_reddit(keyword, limit=n, freshness=freshness)
    if platform == "hackernews":
        return await scrape_hackernews(keyword, limit=n, freshness=freshness)
    if platform == "devto":
        return await scrape_devto(keyword, limit=n)
    if platform == "stackoverflow":
        return await scrape_stackoverflow(keyword, limit=n)
    if platform == "producthunt":
        return await scrape_producthunt(keyword, limit=n)
    if platform == "darkweb":
        return await scrape_darkweb(keyword, limit=n)
    if platform in DORK_SITES:
        return await scrape_google_dork(platform, DORK_SITES[platform], keyword,
                                        limit=n, search_mode=search_mode, freshness=freshness)
    logger.warning("Unknown platform requested: %s", platform)
    return []


def _rate_limit_notice(platform: str, exc: AllBackendsThrottled) -> Dict:
    from scrapers.search_backends import serper_configured
    label = PLATFORM_LABELS.get(platform, platform.capitalize())
    cooldown = getattr(exc, "soonest_retry_s", 900)
    mins = max(1, round(cooldown / 60))
    has_key = serper_configured()

    if has_key:
        # A key exists but every backend (keyed + keyless) is momentarily blocked —
        # usually a transient burst. Don't tell them to add a key they already have.
        message = (
            f"{label}: all search backends are briefly rate-limited. "
            f"Auto-retrying after ~{mins} min — other platforms keep running. "
            f"Your Serper key may be out of credits; add another in Settings to stay unlimited."
        )
    else:
        message = (
            f"{label} hit keyless search rate-limits on every free engine (DuckDuckGo, Yahoo, Bing…). "
            f"Cooling down ~{mins} min to protect your IP — other platforms keep running. "
            f"Add a free SERPER_API_KEY in Settings for unlimited, ban-proof scraping."
        )
    return {
        "type": "rate_limited",
        "platform": platform,
        "label": label,
        "cooldown_seconds": cooldown,
        "cooldown_minutes": mins,
        "has_serper_key": has_key,
        "message": message,
    }


async def scrape_social_orchestrator(platform: str, keyword: str, max_leads: int = 10,
                                     search_mode: str = "auto", freshness=None) -> Dict:
    """
    Routes to the correct platform scraper(s) and returns
    {"leads": [...], "notices": [rate_limited events]}.

    `platform` may be a single id, a comma-separated list (e.g.
    "linkedin,instagram,quora" from the multi-select UI), or "all".
    `freshness` narrows results to a recency window and re-ranks them newest-first.
    """
    from scrapers.dateparse import normalize_freshness, parse_date, within_freshness, freshness_label, recency_key
    freshness = normalize_freshness(freshness)

    # Parse into a clean, de-duplicated platform list.
    requested = [p.strip() for p in (platform or "").lower().split(",") if p.strip()]
    if "all" in requested:
        requested = ALL_PLATFORMS
    requested = list(dict.fromkeys(requested))  # dedupe, preserve order

    leads: List[Dict] = []
    notices: List[Dict] = []
    try:
        if not requested:
            logger.warning("No platform specified")
        elif len(requested) == 1:
            try:
                leads = await _scrape_one(requested[0], keyword, max_leads, search_mode, freshness)
            except AllBackendsThrottled as exc:
                notices.append(_rate_limit_notice(requested[0], exc))
        else:
            # Multiple platforms — run sequentially with a delay to protect DuckDuckGo
            # from burst rate-limits on a single IP when no API keys are provided.
            per = max(1, max_leads // len(requested) + 1)
            for i, p in enumerate(requested):
                if i > 0:
                    await asyncio.sleep(2.5)  # Pace the requests to avoid DDG 202 limits
                try:
                    res = await _scrape_one(p, keyword, per, search_mode, freshness)
                    if isinstance(res, list):
                        leads.extend(res)
                except AllBackendsThrottled as exc:
                    notices.append(_rate_limit_notice(p, exc))
                except Exception as exc:
                    logger.error("Platform %s failed: %s", p, exc)
    except Exception as e:
        logger.error("Error orchestrating scrape for %s: %s", platform, e)

    # ── Freshness pass: stamp age on every lead, drop the stale, rank the fresh ──
    # Native scrapers (Reddit/HN/Dev.to) give an ISO posted_at; dork leads already
    # carry age_hours. Here we unify: parse any missing age, apply the window as a
    # final safety net, and sort so hours-old comments land at the very top.
    for ld in leads:
        if ld.get("age_hours") is None:
            _iso, age = parse_date(ld.get("posted_at") or ld.get("created_at"))
            ld["age_hours"] = age
            if age is not None and not ld.get("freshness_label"):
                ld["freshness_label"] = freshness_label(age)
    if freshness:
        leads = [ld for ld in leads if within_freshness(ld.get("age_hours"), freshness)]
    leads.sort(key=recency_key)
    leads = leads[:max_leads]

    # Standardize the output format for the frontend
    standardized_leads = []
    for lead in leads:
        # Fallbacks to ensure the requested unified schema is present
        # Unified schema: name, website, platform, about_snippet, category
        # Preserve every field the scraper produced (external_id, author,
        # post_content, kind, title, posted_at, …) and only backfill the
        # required keys. Rebuilding from scratch would strip the rich fields
        # that the DB insert and the AI scorer rely on.
        std_lead = dict(lead)
        std_lead.setdefault("name", "Unknown")
        std_lead["name"] = std_lead.get("name") or "Unknown"
        std_lead["website"] = lead.get("website") or lead.get("post_url") or ""
        std_lead["platform"] = lead.get("platform", platform)
        std_lead["about_snippet"] = lead.get("about_snippet") or lead.get("post_content") or ""
        std_lead["category"] = lead.get("category", "Social Post")
        std_lead["address"] = lead.get("address") or platform.capitalize()
        std_lead.setdefault("phone", "")
        std_lead["rating"] = lead.get("rating", "N/A")
        std_lead["reviews"] = lead.get("reviews", "N/A")
        std_lead["created_at"] = lead.get("created_at") or lead.get("posted_at") or ""
        std_lead.setdefault("kind", "post")
        standardized_leads.append(std_lead)

    return {"leads": standardized_leads, "notices": notices}
