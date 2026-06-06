"""
Dev.to scraper — uses the OFFICIAL public Forem API (https://developers.forem.com/api).

The old internal `/search/feed_content` endpoint now returns an empty result set,
so we fetch from the stable `/api/articles` endpoint two ways and merge:
  1. Tag match  — keyword sanitized into a Dev.to tag (e.g. "web dev" -> "webdev").
  2. Keyword match — pull a broad recent feed and filter title/description/tags.
This gives real keyword relevance and never silently breaks on markup changes.
"""

import re
import requests
from datetime import datetime, timezone
from typing import List, Dict
import logging

logger = logging.getLogger(__name__)

API = "https://dev.to/api/articles"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def _to_lead(item: Dict, keyword: str) -> Dict:
    author = (item.get("user") or {}).get("name", "Unknown")
    path = item.get("path", "")
    link = f"https://dev.to{path}" if path else (item.get("url") or "")
    title = item.get("title", "")
    snippet = item.get("description", "") or title
    created_at = item.get("published_at") or item.get("published_timestamp") or datetime.now(timezone.utc).isoformat()
    return {
        "external_id": f"devto_{item.get('id', path)}",
        "name": author,
        "author": author,
        "author_url": (item.get("user") or {}).get("username", "") and f"https://dev.to/{item['user']['username']}",
        "website": link,
        "post_url": link,
        "title": title,
        "platform": "devto",
        "kind": "post",
        "about_snippet": snippet,
        "post_content": snippet,
        "category": "Social Post",
        "address": "Dev.to",
        "phone": "",
        "rating": "N/A",
        "reviews": "N/A",
        "matched_keyword": keyword,
        "created_at": created_at,
        "posted_at": created_at,
    }


def _keyword_tags(keyword: str) -> List[str]:
    """Derive candidate Dev.to tags from a free-text keyword."""
    words = re.findall(r"[a-z0-9]+", keyword.lower())
    tags = []
    if words:
        tags.append("".join(words))      # "web dev" -> "webdev"
        if len(words) > 1:
            tags.append(words[-1])       # last word, often the noun ("developer")
            tags.append(words[0])        # first word
    return list(dict.fromkeys(t for t in tags if len(t) >= 2))[:3]


def _matches(item: Dict, keyword: str) -> bool:
    kw = keyword.lower()
    parts = re.findall(r"[a-z0-9]+", kw)
    hay = " ".join([
        item.get("title", ""),
        item.get("description", ""),
        " ".join(item.get("tag_list", []) if isinstance(item.get("tag_list"), list) else [str(item.get("tag_list", ""))]),
    ]).lower()
    # match if full phrase present OR every significant word present
    if kw in hay:
        return True
    sig = [p for p in parts if len(p) >= 3]
    return bool(sig) and all(p in hay for p in sig)


async def scrape_devto(keyword: str, limit: int = 10) -> List[Dict]:
    """Main entry point called by the orchestrator."""
    leads: List[Dict] = []
    seen: set = set()

    def _add(items, kw, require_match):
        for it in items:
            if require_match and not _matches(it, kw):
                continue
            lead = _to_lead(it, kw)
            if lead["external_id"] not in seen:
                seen.add(lead["external_id"])
                leads.append(lead)

    # 1. Tag-based fetch (most precise when the keyword maps to a real tag)
    for tag in _keyword_tags(keyword):
        if len(leads) >= limit:
            break
        try:
            r = requests.get(API, params={"tag": tag, "per_page": min(limit, 30)},
                             headers={"User-Agent": UA}, timeout=15)
            if r.status_code == 200:
                _add(r.json(), keyword, require_match=False)
            else:
                logger.warning("Dev.to tag '%s' returned %d", tag, r.status_code)
        except (requests.exceptions.RequestException, ValueError) as exc:
            logger.warning("Dev.to tag fetch error: %s", exc)

    # 2. Broad recent feed, filtered by keyword — catches anything tags miss
    if len(leads) < limit:
        try:
            r = requests.get(API, params={"per_page": 100, "top": 30},
                             headers={"User-Agent": UA}, timeout=15)
            if r.status_code == 200:
                _add(r.json(), keyword, require_match=True)
            else:
                logger.warning("Dev.to feed returned %d", r.status_code)
        except (requests.exceptions.RequestException, ValueError) as exc:
            logger.warning("Dev.to feed fetch error: %s", exc)

    return leads[:limit]
