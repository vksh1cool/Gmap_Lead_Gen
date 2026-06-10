import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import List, Dict
import urllib.parse
from bs4 import BeautifulSoup
import requests

from .rate_limiter import rate_limiter

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

def _scrape_ahmia_sync(keyword: str, limit: int) -> List[Dict]:
    leads: List[Dict] = []
    encoded_kw = urllib.parse.quote(keyword)
    url = f"https://ahmia.fi/search/?q={encoded_kw}"
    
    import random
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    
    try:
        resp = requests.get(url, headers=headers, timeout=20)
        if resp.status_code == 429:
            rate_limiter.report_block("darkweb")
            return leads
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, "lxml")
        results = soup.select("li.searchResultsItem")
        
        for res in results[:limit]:
            a_tag = res.select_one("h4 a")
            if not a_tag:
                continue
                
            title = a_tag.get_text(strip=True)
            # Ahmia redirects links through their own proxy sometimes or provides the raw URL
            # The raw text of the <cite> tag contains the actual onion URL.
            cite = res.select_one("cite")
            onion_url = cite.get_text(strip=True) if cite else ""
            if not onion_url.startswith("http"):
                onion_url = f"http://{onion_url}" if onion_url else ""
                
            snippet_elem = res.select_one("p")
            snippet = snippet_elem.get_text(" ", strip=True) if snippet_elem else ""
            
            clean_name = title.split(" - ")[0].split(" | ")[0].strip() or title
            now = datetime.now(timezone.utc).isoformat()
            
            leads.append({
                "external_id": f"darkweb_{hashlib.sha1(onion_url.encode()).hexdigest()[:16]}",
                "name": clean_name,
                "author": clean_name,
                "website": onion_url,
                "post_url": onion_url,
                "title": title,
                "platform": "darkweb",
                "kind": "website",
                "about_snippet": snippet,
                "post_content": snippet,
                "category": "Onion Service",
                "address": "Dark Web / Tor",
                "phone": "",
                "rating": "N/A",
                "reviews": "N/A",
                "matched_keyword": keyword,
                "created_at": now,
                "posted_at": now,
            })
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Ahmia scrape error: {e}")
        
    return leads

async def scrape_darkweb(keyword: str, limit: int = 10) -> List[Dict]:
    """Scrapes Ahmia.fi for .onion links matching the keyword."""
    if not rate_limiter.can_scrape("darkweb"):
        logger.info("Dark Web (Ahmia) rate-limited, skipping")
        return []

    await rate_limiter.wait("darkweb")
    leads = await asyncio.to_thread(_scrape_ahmia_sync, keyword, limit)
    
    if leads:
        rate_limiter.report_success("darkweb")
    return leads
