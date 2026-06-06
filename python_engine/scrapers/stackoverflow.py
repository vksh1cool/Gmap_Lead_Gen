import requests
import urllib.parse
from datetime import datetime, timezone
from typing import List, Dict
import logging

logger = logging.getLogger(__name__)

async def scrape_stackoverflow(keyword: str, limit: int = 10) -> List[Dict]:
    """Scrapes StackOverflow using the official API."""
    leads = []
    encoded_kw = urllib.parse.quote(keyword)
    url = f"https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q={encoded_kw}&site=stackoverflow&pagesize={limit}"
    
    try:
        res = requests.get(url, timeout=15)
        if res.status_code == 200:
            data = res.json()
            for item in data.get('items', []):
                owner = item.get('owner', {})
                author = owner.get('display_name', 'Unknown')
                link = item.get('link', '')
                title = item.get('title', '')
                creation_date = item.get('creation_date')
                
                posted_at = ""
                if creation_date:
                    posted_at = datetime.fromtimestamp(creation_date, tz=timezone.utc).isoformat()
                else:
                    posted_at = datetime.now(timezone.utc).isoformat()
                    
                leads.append({
                    "name": author,
                    "website": link,
                    "platform": "stackoverflow",
                    "about_snippet": title,
                    "category": "Social Post",
                    "address": "StackOverflow",
                    "phone": "",
                    "rating": "N/A",
                    "reviews": "N/A",
                    "created_at": posted_at
                })
        else:
            logger.warning(f"StackOverflow API returned {res.status_code}")
    except Exception as e:
        logger.error(f"StackOverflow scrape error: {e}")
        
    return leads
