"""
Hacker News scraper — uses Algolia HN Search API.
Searches both comments and stories from the last 7 days.
"""

import logging
import time
from datetime import datetime, timezone
from typing import List, Dict
from urllib.parse import quote

import requests

from .rate_limiter import rate_limiter

logger = logging.getLogger(__name__)


def _parse_hits(hits: list, keyword: str, kind: str) -> List[Dict]:
    leads: List[Dict] = []
    for hit in hits:
        obj_id = hit.get("objectID", "")
        author = hit.get("author", "Unknown")
        title = hit.get("title") or hit.get("story_title") or ""
        text = hit.get("comment_text") or hit.get("story_text") or ""
        # Strip basic HTML tags from comment text
        import re
        text = re.sub(r"<[^>]+>", " ", text).strip()

        post_url = hit.get("url") or ""
        if not post_url:
            story_id = hit.get("story_id") or hit.get("objectID")
            post_url = f"https://news.ycombinator.com/item?id={story_id}"

        created_at_i = hit.get("created_at_i")
        posted_at = ""
        if created_at_i:
            try:
                posted_at = datetime.fromtimestamp(
                    int(created_at_i), tz=timezone.utc
                ).isoformat()
            except (ValueError, OSError):
                pass

        full_text = f"{title}\n\n{text}".strip() if title else text.strip()

        leads.append({
            "external_id": f"hn_{obj_id}",
            "platform": "hackernews",
            "kind": kind,
            "name": author,
            "author_url": f"https://news.ycombinator.com/user?id={author}",
            "title": title,
            "post_content": full_text,
            "post_url": post_url,
            "website": post_url,
            "address": "Hacker News",
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


async def scrape_hackernews(keyword: str, limit: int = 30) -> List[Dict]:
    """Main entry point called by the orchestrator."""
    if not rate_limiter.can_scrape("hackernews"):
        logger.info("HackerNews rate-limited or circuit-broken, skipping")
        return []

    await rate_limiter.wait("hackernews")

    all_leads: List[Dict] = []
    seen_ids: set = set()
    seven_days_ago = int(time.time()) - 7 * 86400
    encoded = quote(keyword)
    cap = min(limit, 50)

    # 1. Search comments
    comments_url = (
        f"https://hn.algolia.com/api/v1/search_by_date"
        f"?query={encoded}&tags=comment&hitsPerPage={cap}"
        f"&numericFilters=created_at_i>{seven_days_ago}"
    )
    try:
        resp = requests.get(comments_url, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            hits = data.get("hits", [])
            for lead in _parse_hits(hits, keyword, "comment"):
                if lead["external_id"] not in seen_ids:
                    seen_ids.add(lead["external_id"])
                    all_leads.append(lead)
        elif resp.status_code == 429:
            rate_limiter.report_block("hackernews")
        else:
            logger.warning("HN Algolia comments returned %d", resp.status_code)
    except requests.exceptions.Timeout:
        logger.warning("HN Algolia comments timed out")
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.warning("HN Algolia comments error: %s", exc)

    # 2. Search stories
    await rate_limiter.wait("hackernews")
    stories_url = (
        f"https://hn.algolia.com/api/v1/search_by_date"
        f"?query={encoded}&tags=story&hitsPerPage={cap}"
        f"&numericFilters=created_at_i>{seven_days_ago}"
    )
    try:
        resp = requests.get(stories_url, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            hits = data.get("hits", [])
            for lead in _parse_hits(hits, keyword, "post"):
                if lead["external_id"] not in seen_ids:
                    seen_ids.add(lead["external_id"])
                    all_leads.append(lead)
        elif resp.status_code == 429:
            rate_limiter.report_block("hackernews")
        else:
            logger.warning("HN Algolia stories returned %d", resp.status_code)
    except requests.exceptions.Timeout:
        logger.warning("HN Algolia stories timed out")
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.warning("HN Algolia stories error: %s", exc)

    if all_leads:
        rate_limiter.report_success("hackernews")

    return all_leads[:limit]
