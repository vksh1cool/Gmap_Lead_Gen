import hashlib
import os
import urllib.parse
from datetime import datetime, timezone
from typing import List, Dict
from playwright.async_api import async_playwright, TimeoutError
import logging

from .search_backends import AllBackendsThrottled

logger = logging.getLogger(__name__)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Nitter instances rotate / die constantly. Try several; the first that yields
# results wins. Override / extend via the NITTER_INSTANCES env var (comma-sep).
DEFAULT_INSTANCES = [
    "https://nitter.privacyredirect.com",
    "https://nitter.poast.org",
    "https://lightbrd.com",
    "https://nitter.net",
]


def _instances() -> List[str]:
    env = os.getenv("NITTER_INSTANCES", "").strip()
    if env:
        return [u.strip().rstrip("/") for u in env.split(",") if u.strip()]
    return DEFAULT_INSTANCES


async def _scrape_instance(page, base: str, keyword: str, max_leads: int) -> List[Dict]:
    leads: List[Dict] = []
    encoded_kw = urllib.parse.quote(keyword)
    url = f"{base}/search?f=tweets&q={encoded_kw}"
    await page.goto(url, timeout=20000, wait_until="domcontentloaded")
    await page.wait_for_selector('.timeline-item', timeout=8000)

    items = await page.query_selector_all('.timeline-item')
    for item in items[:max_leads]:
        content_elem = await item.query_selector('.tweet-content')
        author_elem = await item.query_selector('.fullname')
        username_elem = await item.query_selector('.username')
        link_elem = await item.query_selector('.tweet-link')
        date_elem = await item.query_selector('.tweet-date a')

        if not content_elem or not author_elem:
            continue

        content = (await content_elem.inner_text()).strip()
        author = (await author_elem.inner_text()).strip()
        username = (await username_elem.inner_text()).strip() if username_elem else ""
        href = await link_elem.get_attribute('href') if link_elem else ""
        post_url = f"https://x.com{href.replace('#m', '')}" if href else ""
        posted_at = await date_elem.get_attribute('title') if date_elem else ""

        leads.append({
            # Stable id (not Python's per-process-randomized hash()) so the same
            # tweet upserts instead of duplicating on every server restart.
            "external_id": f"x_{hashlib.sha1((post_url or content).encode()).hexdigest()[:16]}",
            "name": author,
            "author": author,
            "author_url": f"https://x.com/{username.lstrip('@')}" if username else "",
            "website": post_url,
            "post_url": post_url,
            "title": "",
            "platform": "x",
            "kind": "post",
            "address": "X / Twitter",
            "phone": "",
            "about_snippet": content[:500],
            "post_content": content,
            "rating": "N/A",
            "reviews": "N/A",
            "category": "Social Post",
            "matched_keyword": keyword,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "posted_at": posted_at or "",
        })
    return leads


async def scrape_x(keyword: str, max_leads: int = 10) -> List[Dict]:
    """
    Playwright headless scrape of X.com via Nitter search, with instance fallback.
    """
    any_responded = False  # did at least one mirror serve a timeline (vs all dead)?
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationControlled']
            )
            context = await browser.new_context(user_agent=UA, locale="en-US")
            page = await context.new_page()
            try:
                for base in _instances():
                    try:
                        leads = await _scrape_instance(page, base, keyword, max_leads)
                        any_responded = True
                        if leads:
                            logger.info("Nitter instance %s returned %d tweets", base, len(leads))
                            return leads
                        logger.info("Nitter instance %s returned 0 — trying next", base)
                    except TimeoutError:
                        logger.warning("Nitter instance %s timed out — trying next", base)
                    except Exception as exc:
                        logger.warning("Nitter instance %s failed: %s — trying next", base, exc)
            finally:
                await browser.close()
    except Exception as e:
        logger.error("Twitter scrape error: %s", e)

    if not any_responded:
        # Every mirror was dead/blocked — surface a cooldown so the UI can pause X.
        logger.warning("All Nitter instances down for '%s'. Falling back to google_dork.", keyword)
        try:
            from .google_dork import scrape_google_dork
            return await scrape_google_dork("x", "x.com", keyword, limit=max_leads)
        except Exception as e:
            logger.error("Fallback google_dork for X failed: %s", e)
            raise AllBackendsThrottled(["nitter", "google_dork_fallback"], 30 * 60)
            
    return []  # mirrors worked but the search genuinely had no tweets
