"""
Reddit scraper.

Reddit retired the anonymous `.json` search API — unauthenticated requests now
get a hard 403. So this scraper has two paths:

  1. OAuth (rich data: post body, author, timestamps) — used when
     REDDIT_CLIENT_ID (+ optional REDDIT_CLIENT_SECRET) are set in the env.
     Free to obtain at https://www.reddit.com/prefs/apps (create a "script" or
     "installed" app). Uses the userless application-only OAuth flow.

  2. Google-dork fallback (zero-config) — `site:reddit.com "keyword"` via the
     shared dork engine. Lower fidelity but needs no credentials, so Reddit
     still produces leads out of the box.
"""

import os
import time
import random
import logging
from datetime import datetime, timezone
from typing import List, Dict
from urllib.parse import quote

import requests

from .rate_limiter import rate_limiter
from .google_dork import scrape_google_dork

logger = logging.getLogger(__name__)

# Descriptive UA per Reddit API rules: <platform>:<app id>:<version> (by /u/<user>)
OAUTH_UA = os.getenv("REDDIT_USER_AGENT", "python:gmaps-lead-scraper:1.0 (by /u/lead_research)")

SUBREDDITS = [
    "forhire", "freelance", "webdev", "smallbusiness",
    "startups", "SaaS", "Entrepreneur", "marketing",
]

# Cache the OAuth token across calls until it expires.
_token_cache = {"token": None, "expires_at": 0.0}


def _get_oauth_token() -> str:
    """Fetch (and cache) an application-only OAuth bearer token, or '' if unconfigured."""
    client_id = os.getenv("REDDIT_CLIENT_ID")
    if not client_id:
        return ""

    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "")
    try:
        if client_secret:
            # Confidential ("script"/"web") app → client_credentials grant.
            auth = requests.auth.HTTPBasicAuth(client_id, client_secret)
            data = {"grant_type": "client_credentials"}
        else:
            # Installed app (no secret) → userless device flow.
            auth = requests.auth.HTTPBasicAuth(client_id, "")
            data = {
                "grant_type": "https://oauth.reddit.com/grants/installed_client",
                "device_id": "DO_NOT_TRACK_THIS_DEVICE",
            }
        resp = requests.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=auth, data=data,
            headers={"User-Agent": OAUTH_UA}, timeout=15,
        )
        if resp.status_code == 200:
            j = resp.json()
            tok = j.get("access_token", "")
            _token_cache["token"] = tok
            _token_cache["expires_at"] = now + float(j.get("expires_in", 3600)) - 60
            return tok
        logger.warning("Reddit OAuth token request failed: %d %s", resp.status_code, resp.text[:120])
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.warning("Reddit OAuth token error: %s", exc)
    return ""


def _parse_posts(raw_json: dict, keyword: str) -> List[Dict]:
    """Parse a Reddit listing JSON into our standard lead format."""
    leads: List[Dict] = []
    children = raw_json.get("data", {}).get("children", [])
    for child in children:
        p = child.get("data", {})
        if not p:
            continue

        selftext = p.get("selftext", "")
        if selftext in ("[removed]", "[deleted]", ""):
            selftext = ""

        title = p.get("title", "")
        body = p.get("body", "")  # for comments
        content = selftext or body
        full_text = f"{title}\n\n{content}".strip() if title else content.strip()

        created_utc = p.get("created_utc")
        posted_at = ""
        if created_utc:
            try:
                posted_at = datetime.fromtimestamp(float(created_utc), tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                pass

        author = p.get("author", "Unknown")
        permalink = p.get("permalink", "")
        post_url = f"https://reddit.com{permalink}" if permalink else ""
        post_id = p.get("id", "")
        kind = "comment" if body else "post"

        leads.append({
            "external_id": f"reddit_{post_id}",
            "platform": "reddit",
            "kind": kind,
            "name": author,
            "author": author,
            "author_url": f"https://reddit.com/u/{author}" if author != "Unknown" else "",
            "title": title,
            "post_content": full_text,
            "post_url": post_url,
            "website": post_url,
            "address": "Reddit",
            "phone": "",
            "rating": "N/A",
            "reviews": "N/A",
            "category": "Social Post",
            "about_snippet": full_text[:500],
            "posted_at": posted_at,
            "matched_keyword": keyword,
            "emails_found": [],
            "socials": [],
            "is_claimed": True,
        })
    return leads


def _oauth_get(path: str, token: str, params: dict) -> dict:
    """GET against oauth.reddit.com with the bearer token."""
    try:
        resp = requests.get(
            f"https://oauth.reddit.com{path}",
            headers={"Authorization": f"bearer {token}", "User-Agent": OAUTH_UA},
            params=params, timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (401, 403):
            _token_cache["token"] = None  # force refresh next time
            rate_limiter.report_block("reddit")
        elif resp.status_code == 429:
            rate_limiter.report_block("reddit")
        logger.warning("Reddit OAuth GET %s -> %d", path, resp.status_code)
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.warning("Reddit OAuth GET error: %s", exc)
    return {}


async def _scrape_via_oauth(keyword: str, token: str, limit: int) -> List[Dict]:
    all_leads: List[Dict] = []
    seen_ids: set = set()

    def _ingest(data: dict):
        for lead in _parse_posts(data, keyword):
            if lead["external_id"] not in seen_ids:
                seen_ids.add(lead["external_id"])
                all_leads.append(lead)

    # 1. Global search
    await rate_limiter.wait("reddit")
    _ingest(_oauth_get("/search", token, {"q": keyword, "sort": "new", "t": "month", "limit": limit, "raw_json": 1}))

    # 2. A few targeted subreddits
    for sub in random.sample(SUBREDDITS, min(4, len(SUBREDDITS))):
        if len(all_leads) >= limit:
            break
        await rate_limiter.wait("reddit")
        _ingest(_oauth_get(f"/r/{sub}/search", token,
                           {"q": keyword, "restrict_sr": 1, "sort": "new", "t": "month", "limit": 10, "raw_json": 1}))

    if all_leads:
        rate_limiter.report_success("reddit")
    return all_leads[:limit]


async def _scrape_via_dork(keyword: str, limit: int) -> List[Dict]:
    """Zero-config fallback: dork reddit.com via Google."""
    leads = await scrape_google_dork("reddit", "reddit.com", keyword, limit=limit)
    for lead in leads:
        lead["address"] = "Reddit"
        lead["author_url"] = lead.get("post_url", "")
    return leads


async def scrape_reddit(keyword: str, limit: int = 30) -> List[Dict]:
    """Main entry point called by the orchestrator."""
    if not rate_limiter.can_scrape("reddit"):
        logger.info("Reddit rate-limited or circuit-broken, skipping")
        return []

    token = _get_oauth_token()
    if token:
        leads = await _scrape_via_oauth(keyword, token, limit)
        if leads:
            return leads
        logger.info("Reddit OAuth returned 0 — falling back to dork")
    else:
        logger.info("Reddit OAuth not configured (set REDDIT_CLIENT_ID) — using dork fallback")

    return await _scrape_via_dork(keyword, limit)
