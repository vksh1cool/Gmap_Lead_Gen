"""
ProductHunt scraper.

Primary path: the official GraphQL API (https://api.producthunt.com/v2/api/graphql)
using a free developer token (PRODUCTHUNT_TOKEN). Makers/hunters launching products
are prime agency leads (they need web/SEO/marketing), so we surface the post + maker.

Fallback (no token): dork producthunt.com via the shared search-backend layer.
"""

import asyncio
import os
import logging
from datetime import datetime, timezone
from typing import List, Dict

import requests

from .google_dork import scrape_google_dork
from .search_backends import AllBackendsThrottled  # noqa: F401 (propagated by fallback)

logger = logging.getLogger(__name__)

GRAPHQL = "https://api.producthunt.com/v2/api/graphql"

# Pull recent posts; PH's public API has no full-text post search, so we fetch a
# window of recent launches and keyword-filter client-side (like the dev.to path).
_QUERY = """
query RecentPosts($after: String) {
  posts(first: 50, order: NEWEST, after: $after) {
    edges {
      node {
        id name tagline description url votesCount commentsCount createdAt
        user { name username }
        makers { name username }
        topics(first: 5) { edges { node { name } } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""


def _matches(node: dict, keyword: str) -> bool:
    kw = keyword.lower()
    hay = " ".join([
        node.get("name", ""), node.get("tagline", ""), node.get("description", ""),
        " ".join(e["node"]["name"] for e in (node.get("topics", {}) or {}).get("edges", [])),
    ]).lower()
    if kw in hay:
        return True
    sig = [w for w in kw.split() if len(w) >= 3]
    return bool(sig) and all(w in hay for w in sig)


def _to_lead(node: dict, keyword: str) -> Dict:
    maker = ""
    maker_user = ""
    makers = node.get("makers") or []
    if makers:
        maker = makers[0].get("name", "")
        maker_user = makers[0].get("username", "")
    if not maker:
        u = node.get("user") or {}
        maker, maker_user = u.get("name", "Unknown"), u.get("username", "")

    desc = node.get("description") or node.get("tagline") or ""
    created = node.get("createdAt") or datetime.now(timezone.utc).isoformat()
    return {
        "external_id": f"producthunt_{node.get('id')}",
        "name": maker or "Unknown",
        "author": maker or "Unknown",
        "author_url": f"https://www.producthunt.com/@{maker_user}" if maker_user else "",
        "website": node.get("url", ""),
        "post_url": node.get("url", ""),
        "title": node.get("name", ""),
        "platform": "producthunt",
        "kind": "post",
        "about_snippet": f"{node.get('tagline','')} — {desc}"[:500],
        "post_content": desc,
        "category": "Social Post",
        "address": "ProductHunt",
        "phone": "",
        "rating": "N/A",
        "reviews": str(node.get("votesCount", "")),
        "matched_keyword": keyword,
        "created_at": created,
        "posted_at": created,
    }


def _scrape_api(keyword: str, token: str, limit: int) -> List[Dict]:
    leads: List[Dict] = []
    seen: set = set()
    after = None
    pages = 0
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}

    while len(leads) < limit and pages < 4:
        pages += 1
        try:
            r = requests.post(GRAPHQL, headers=headers,
                              json={"query": _QUERY, "variables": {"after": after}}, timeout=20)
        except requests.exceptions.RequestException as exc:
            logger.warning("ProductHunt API error: %s", exc)
            break
        if r.status_code in (401, 403):
            logger.error("ProductHunt auth failed (%d) — check PRODUCTHUNT_TOKEN", r.status_code)
            break
        if r.status_code == 429:
            logger.warning("ProductHunt API rate-limited (429)")
            break
        if r.status_code != 200:
            logger.warning("ProductHunt API returned %d", r.status_code)
            break
        try:
            posts = (r.json().get("data", {}) or {}).get("posts", {}) or {}
        except ValueError:
            break
        for edge in posts.get("edges", []):
            node = edge.get("node", {})
            if not node or not _matches(node, keyword):
                continue
            lead = _to_lead(node, keyword)
            if lead["external_id"] not in seen:
                seen.add(lead["external_id"])
                leads.append(lead)
        page_info = posts.get("pageInfo", {})
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")

    return leads[:limit]


async def scrape_producthunt(keyword: str, limit: int = 10) -> List[Dict]:
    """Main entry point. Native API when PRODUCTHUNT_TOKEN is set, else dork fallback."""
    token = os.getenv("PRODUCTHUNT_TOKEN")
    if token:
        leads = await asyncio.to_thread(_scrape_api, keyword, token, limit)
        if leads:
            return leads
        logger.info("ProductHunt API returned 0 — falling back to dork")
    else:
        logger.info("PRODUCTHUNT_TOKEN not set — using dork fallback")
    # Propagates AllBackendsThrottled if the search layer is fully throttled.
    return await scrape_google_dork("producthunt", "producthunt.com", keyword, limit=limit)
