"""
Site-dork scraper — a thin wrapper over the pluggable search-backend layer.

Builds a `site:<domain> "<keyword>"` query and runs it through search_backends
(Serper → Brave → Google CSE → SearXNG → DDG → Mojeek). When every available
backend is throttled it raises AllBackendsThrottled so the orchestrator can show
the "rate-limited, cooling down" dialog instead of returning silent zeros.
"""

import asyncio
import hashlib
from datetime import datetime, timezone
from typing import List, Dict
import logging

from .search_backends import web_search, AllBackendsThrottled  # noqa: F401 (re-exported)
from .intent_dorks import expand_keyword_to_dorks

logger = logging.getLogger(__name__)


def _dork_sync(platform_name: str, site_domain: str, keyword: str, limit: int, search_mode: str = "auto") -> List[Dict]:
    dorks = expand_keyword_to_dorks(platform_name, site_domain, keyword)

    leads: List[Dict] = []
    seen: set = set()
    
    for query in dorks:
        if len(leads) >= limit:
            break
            
        results = web_search(query, limit, search_mode)  # may raise AllBackendsThrottled
        
        for r in results:
            if len(leads) >= limit:
                break
            href = r.get("url", "")
            # Keep only genuine links to the target domain.
            if not href or site_domain not in href:
                continue
            if href in seen:
                continue
            seen.add(href)
    
            title = (r.get("title") or "").strip()
            if not title:
                continue
            snippet = (r.get("snippet") or "").strip()
    
            clean_name = title.split(" - ")[0].split(" | ")[0].strip() or title
            now = datetime.now(timezone.utc).isoformat()
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
                "created_at": now,
                "posted_at": now,
            })

    if not leads:
        logger.info("Dork for %s ('%s') found 0 results", platform_name, keyword)
    return leads


async def scrape_google_dork(platform_name: str, site_domain: str, keyword: str, limit: int = 10, search_mode: str = "auto") -> List[Dict]:
    """Async wrapper — runs the blocking HTTP+parse off the event loop.

    Propagates AllBackendsThrottled to the caller so a cooldown dialog can fire.
    """
    leads = await asyncio.to_thread(_dork_sync, platform_name, site_domain, keyword, limit, search_mode)
    
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
