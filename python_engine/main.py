import asyncio
import json
import random
import re
import math
from urllib.parse import quote

# Load python_engine/.env (SERPER_API_KEY, REDDIT_CLIENT_ID, PRODUCTHUNT_TOKEN, …)
# before any scraper reads os.getenv. Safe no-op if the file is absent.
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from playwright.async_api import async_playwright, TimeoutError, Page, BrowserContext
from playwright_stealth import Stealth
from pydantic import BaseModel
from social_scraper import scrape_social_orchestrator
from scrapers.serper_keys import key_manager
from scrapers.website_mirror import scrape_website_mirror
from scrapers.extract import extract_emails, extract_socials, valid_email

async def stealth_async(page):
    await Stealth().apply_stealth_async(page)

app = FastAPI()


# ── Serper key-pool management (rotation across free 2,500-credit accounts) ──
class SerperKeyIn(BaseModel):
    key: str


@app.get("/serper-keys")
async def list_serper_keys():
    keys = key_manager.list_status()
    return {
        "keys": keys,
        "active_count": sum(1 for k in keys if not k["exhausted"]),
        "total": len(keys),
    }


@app.post("/serper-keys")
async def add_serper_key(body: SerperKeyIn):
    ok = key_manager.add_key(body.key)
    return {"success": ok, "keys": key_manager.list_status()}


@app.delete("/serper-keys/{tail}")
async def delete_serper_key(tail: str):
    ok = key_manager.remove_key_by_tail(tail)
    return {"success": ok, "keys": key_manager.list_status()}

EMAIL_REGEX = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
SOCIAL_REGEX = r"https?://(?:www\.)?(facebook\.com|twitter\.com|linkedin\.com|instagram\.com)/[a-zA-Z0-9._-]+"

class AntiBanEngine:
    def __init__(self):
        self.consecutive_blocks = 0
        self.max_blocks = 3
        self.is_circuit_open = False
        
    async def human_delay(self, min_ms=500, max_ms=2000):
        """Randomized exponential delays with jitter."""
        base_delay = random.uniform(min_ms, max_ms)
        # Exponential backoff if we're hitting blocks
        multiplier = math.pow(2.0, self.consecutive_blocks)
        # Add random jitter to the multiplier
        jitter = random.uniform(0.9, 1.1)
        
        final_delay_ms = base_delay * multiplier * jitter
        # Cap max delay to avoid infinite stalls
        final_delay_ms = min(final_delay_ms, 20000)
        
        await asyncio.sleep(final_delay_ms / 1000.0)

    async def check_captcha_or_block(self, page: Page):
        """Checks if Google is presenting a CAPTCHA or blocking the page."""
        try:
            url = page.url
            if "sorry/index" in url:
                self._record_block()
                return True
                
            # Quick check for recaptcha iframes or unusual traffic text
            is_captcha = await page.locator('iframe[src*="recaptcha"]').count() > 0
            has_unusual_traffic = await page.locator('text="Our systems have detected unusual traffic"').count() > 0
            
            if is_captcha or has_unusual_traffic:
                self._record_block()
                return True
                
            # If successful page load, slightly decay the block count
            if self.consecutive_blocks > 0:
                self.consecutive_blocks = max(0, self.consecutive_blocks - 0.5)
                
            return False
        except Exception:
            return False
            
    def _record_block(self):
        self.consecutive_blocks += 1
        if self.consecutive_blocks >= self.max_blocks:
            self.is_circuit_open = True

_CONTACT_HINTS = ("contact", "about", "reach", "connect", "get-in-touch",
                  "getintouch", "team", "support", "enquir", "hire")


async def crawl_website(url: str, context: BrowserContext, engine: AntiBanEngine):
    """Visit a website and harvest emails/socials/about text.

    Depth upgrade (gosom google-maps-scraper lesson): most businesses hide their
    email on /contact or /about, not the homepage — so we crawl the homepage,
    then follow up to two contact/about pages, stopping as soon as we get an email.
    mailto: links are read directly (highest-signal address on the page).
    """
    if not url:
        return [], [], ""
    emails, socials = set(), set()
    about_snippet = ""
    visited = set()

    async def harvest(page_url: str):
        nonlocal about_snippet
        if not page_url or page_url in visited or len(visited) >= 3:
            return []
        visited.add(page_url)
        page = await context.new_page()
        await stealth_async(page)
        try:
            await engine.human_delay(400, 1200)
            await page.goto(page_url, timeout=10000, wait_until="domcontentloaded")
            content = await page.content()
            for e in extract_emails(content):
                emails.add(e)
            for s in extract_socials(content):
                socials.add(s)
            # mailto: links — the cleanest email signal on any page.
            try:
                hrefs = await page.eval_on_selector_all(
                    'a[href^="mailto:"]', "els => els.map(e => e.getAttribute('href'))")
                for h in hrefs or []:
                    addr = (h or "").replace("mailto:", "").split("?")[0].strip()
                    if addr and valid_email(addr):
                        emails.add(addr)
            except Exception:
                pass
            if not about_snippet:
                paragraphs = await page.locator('p').all_text_contents()
                valid_p = [p.strip() for p in paragraphs if len(p.strip()) > 30]
                about_snippet = " ".join(valid_p[:3])[:500]
            # Return same-site links so the caller can pick contact/about pages.
            try:
                return await page.eval_on_selector_all('a[href]', "els => els.map(e => e.href)")
            except Exception:
                return []
        except Exception:
            return []
        finally:
            await page.close()

    links = await harvest(url) or []
    if not emails:  # only spend extra page-loads if the homepage gave us nothing
        base = url.rstrip("/")
        candidates = [l for l in links
                      if l and l.startswith("http") and any(h in l.lower() for h in _CONTACT_HINTS)]
        if not candidates:
            candidates = [f"{base}/contact", f"{base}/contact-us", f"{base}/about"]
        for c in candidates[:2]:
            if emails:
                break
            await harvest(c)

    return list(emails), list(socials), about_snippet

async def process_business_url(href: str, context: BrowserContext, engine: AntiBanEngine):
    """Visits a Google Maps business URL and extracts all details, plus website crawl."""
    if engine.is_circuit_open:
        return {"error": "Circuit open", "url": href}
        
    page = await context.new_page()
    await stealth_async(page)
    try:
        await engine.human_delay(800, 2000)
        await page.goto(href, timeout=15000)
        
        is_blocked = await engine.check_captcha_or_block(page)
        if is_blocked:
            return {"error": "Google CAPTCHA or block detected", "url": href}
            
        await page.wait_for_selector('h1', timeout=5000)
        
        name = ""
        try:
            name_el = await page.locator('h1').first.text_content()
            name = name_el.strip() if name_el else ""
        except Exception: pass
        
        rating, reviews = "", ""
        try:
            rating_el = page.locator('[aria-label*="stars"]').first
            if await rating_el.count() > 0:
                aria_label = await rating_el.get_attribute("aria-label")
                if aria_label:
                    m = re.search(r"([\d.]+)\s*star", aria_label, re.IGNORECASE)
                    if m:
                        rating = m.group(1)
                    m_rev = re.search(r"([\d,]+)\s*review", aria_label, re.IGNORECASE)
                    if m_rev:
                        reviews = m_rev.group(1).replace(",", "")
            
            if not reviews:
                review_button = page.locator('[aria-label*="review"]').first
                if await review_button.count() > 0:
                    aria_label = await review_button.get_attribute("aria-label")
                    if aria_label:
                        m = re.search(r"([\d,]+)\s*review", aria_label, re.IGNORECASE)
                        if m:
                            reviews = m.group(1).replace(",", "")
        except Exception: pass
            
        website = ""
        try:
            website_el = page.locator('a[data-item-id="authority"]').first
            if await website_el.count() > 0:
                website = await website_el.get_attribute("href")
        except Exception: pass
            
        phone = ""
        try:
            phone_el = page.locator('button[data-tooltip*="phone number"]').first
            if await phone_el.count() > 0:
                aria_label = await phone_el.get_attribute("aria-label")
                if aria_label:
                    phone = aria_label.replace("Phone:", "").strip()
        except Exception: pass

        address = ""
        try:
            address_el = page.locator('button[data-item-id="address"]').first
            if await address_el.count() > 0:
                aria_label = await address_el.get_attribute("aria-label")
                if aria_label:
                    address = aria_label.replace("Address:", "").strip()
        except Exception: pass

        is_claimed = True
        try:
            claim_el = page.locator('a[data-item-id*="claim_business"]').first
            if await claim_el.count() > 0 or await page.locator('text="Own this business?"').count() > 0:
                is_claimed = False
        except Exception: pass

        # ── Deep fields (gosom google-maps-scraper lesson) — all best-effort ──
        category = ""
        try:
            cat_el = page.locator('button[jsaction*="category"]').first
            if await cat_el.count() > 0:
                category = (await cat_el.text_content() or "").strip()
        except Exception: pass

        # GPS coordinates are embedded in the canonical map URL (/@lat,lng,zoom).
        coordinates = ""
        try:
            m = re.search(r"/@(-?\d+\.\d+),(-?\d+\.\d+)", page.url)
            if m:
                coordinates = f"{m.group(1)},{m.group(2)}"
        except Exception: pass

        hours = ""
        try:
            # The live status line reads like "Open ⋅ Closes 6 PM" / "Closed ⋅ Opens 8 AM".
            for sel in ('[jsaction*="openhours"]', 'button[data-item-id*="oh"]',
                        'span:has-text("Closes")', 'span:has-text("Opens")'):
                el = page.locator(sel).first
                if await el.count() > 0:
                    txt = (await el.text_content() or "").strip()
                    if txt and txt.lower() not in ("hours", "suggest an edit"):
                        hours = " ".join(txt.split())[:120]
                        break
                    lbl = (await el.get_attribute("aria-label") or "").strip()
                    if lbl and "hour" not in lbl.lower():
                        hours = lbl[:120]
                        break
        except Exception: pass

        price_level = ""
        try:
            price_el = page.locator('[aria-label*="Price"], [aria-label*="Price range"]').first
            if await price_el.count() > 0:
                pl = (await price_el.get_attribute("aria-label") or "").strip()
                pm = re.search(r"(\$+|₹+|€+|£+|\d[\d,]*\s*[–-]\s*\d[\d,]*)", pl)
                price_level = pm.group(1) if pm else pl[:40]
        except Exception: pass

        # Deep crawl if website exists
        emails, socials, about_snippet = [], [], ""
        if website:
            emails, socials, about_snippet = await crawl_website(website, context, engine)

        return {
            "name": name,
            "rating": rating,
            "reviews": reviews,
            "website": website,
            "phone": phone,
            "address": address,
            "url": href,
            "google_maps_url": href,
            "is_claimed": is_claimed,
            "category": category,
            "coordinates": coordinates,
            "hours": hours,
            "price_level": price_level,
            "emails_found": emails,
            "socials": socials,
            "about_snippet": about_snippet
        }
    except Exception as e:
        return {"error": "Failed to load page", "url": href}
    finally:
        await page.close()

async def scrape_google_maps(niche: str, location: str, limit: int):
    engine = AntiBanEngine()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
            ]
        )
        try:
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = await context.new_page()
            await stealth_async(page)
    
            try:
                search_query = f"{niche} in {location}"
                search_url = f"https://www.google.com/maps/search/{quote(search_query)}"
                
                await engine.human_delay(1000, 2000)
                try:
                    await page.goto(search_url, timeout=20000, wait_until="domcontentloaded")
                except TimeoutError:
                    yield json.dumps({"type": "error", "message": "Google Maps failed to load (Timeout)."}) + "\n"
                    return
    
                is_blocked = await engine.check_captcha_or_block(page)
                if is_blocked:
                    yield json.dumps({"type": "error", "message": "Google CAPTCHA or block detected on initial search."}) + "\n"
                    return
    
                try:
                    accept_button = page.locator('button:has-text("Accept all")')
                    if await accept_button.count() > 0:
                        await accept_button.first.click()
                        await engine.human_delay(1000, 2000)
                except Exception: pass
    
                try:
                    await page.wait_for_selector('div[role="feed"]', timeout=15000)
                except TimeoutError:
                    yield json.dumps({"error": "Feed not found"}) + "\n"
                    return
    
                processed_urls = set()
                extracted_count = 0
                stale_scroll_count = 0
    
                # Phase 1: Scroll and collect URLs quickly
                while len(processed_urls) < limit:
                    if engine.is_circuit_open:
                        yield json.dumps({"type": "error", "message": "Circuit breaker triggered during scroll. Google has blocked scraping."}) + "\n"
                        break
                        
                    is_blocked = await engine.check_captcha_or_block(page)
                    if is_blocked:
                        yield json.dumps({"type": "warning", "message": "CAPTCHA/Block encountered during scroll. Backing off..."}) + "\n"
                        if engine.is_circuit_open:
                            break
                            
                    cards = await page.locator('a[href*="/maps/place/"]').all()
                    new_cards = False
                    for card in cards:
                        href = await card.get_attribute("href")
                        if href and href not in processed_urls:
                            processed_urls.add(href)
                            new_cards = True
                            if len(processed_urls) >= limit: break
    
                    yield json.dumps({"type": "info", "message": f"Locating businesses... Found {len(processed_urls)} so far."}) + "\n"
    
                    if len(processed_urls) >= limit: break
    
                    feed = page.locator('div[role="feed"]')
                    if await feed.count() > 0:
                        await feed.hover()
                        await page.mouse.wheel(0, 2000)
                        await engine.human_delay(1500, 3000) # Slightly higher base wait on scroll
                        
                    if not new_cards:
                        stale_scroll_count += 1
                        if stale_scroll_count > 4: break
            finally:
                await page.close()
    
            # Phase 2: Process URLs concurrently in chunks of 5
            urls_to_process = list(processed_urls)[:limit]
            chunk_size = 5
            
            for i in range(0, len(urls_to_process), chunk_size):
                if engine.is_circuit_open:
                    yield json.dumps({"type": "error", "message": "Circuit breaker triggered. Aborting further scraping."}) + "\n"
                    break
    
                chunk = urls_to_process[i:i+chunk_size]
                tasks = [asyncio.create_task(process_business_url(url, context, engine)) for url in chunk]
                
                for completed_task in asyncio.as_completed(tasks):
                    result = await completed_task
                    if result and "error" in result:
                        if result["error"] == "Circuit open":
                            continue
                        yield json.dumps({"type": "warning", "message": result["error"], "url": result.get("url")}) + "\n"
                    elif result and result.get("name"):
                        yield json.dumps(result) + "\n"
                        extracted_count += 1
        except asyncio.CancelledError:
            pass
        finally:
            await browser.close()

@app.get("/scrape")
async def scrape_endpoint(niche: str, location: str, limit: int = 10):
    return StreamingResponse(
        scrape_google_maps(niche, location, limit),
        media_type="application/x-ndjson"
    )

async def stream_social_leads(platform: str, keyword: str, limit: int, search_mode: str = "auto",
                              freshness: str = ""):
    result = await scrape_social_orchestrator(platform, keyword, limit, search_mode, freshness or None)
    # Emit rate-limit notices first so the UI can pop the cooldown dialog early.
    for notice in result.get("notices", []):
        yield json.dumps(notice) + "\n"
    for lead in result.get("leads", []):
        yield json.dumps(lead) + "\n"

@app.get("/scrape-social")
async def scrape_social_endpoint(platform: str, keyword: str, limit: int = 10,
                                 search_mode: str = "auto", freshness: str = ""):
    return StreamingResponse(
        stream_social_leads(platform, keyword, limit, search_mode, freshness),
        media_type="application/x-ndjson"
    )


async def stream_website_leads(url: str, depth: int, max_time: int):
    """Mirror a website with HTTrack and stream extracted contact leads as NDJSON."""
    async for event in scrape_website_mirror(url, depth=depth, max_time=max_time):
        yield json.dumps(event) + "\n"


@app.get("/scrape-website")
async def scrape_website_endpoint(url: str, depth: int = 2, max_time: int = 90):
    return StreamingResponse(
        stream_website_leads(url, depth, max_time),
        media_type="application/x-ndjson"
    )
