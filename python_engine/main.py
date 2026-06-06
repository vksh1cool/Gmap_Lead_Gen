import asyncio
import json
import random
import re
import math
from urllib.parse import quote
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from playwright.async_api import async_playwright, TimeoutError, Page, BrowserContext
from playwright_stealth import Stealth

async def stealth_async(page):
    await Stealth().apply_stealth_async(page)

app = FastAPI()

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

async def crawl_website(url: str, context: BrowserContext, engine: AntiBanEngine):
    """Visits a website to extract emails, socials, and about text."""
    if not url: return [], [], ""
    emails, socials, about_snippet = set(), set(), ""
    page = await context.new_page()
    await stealth_async(page)
    try:
        await engine.human_delay(500, 1500)
        await page.goto(url, timeout=10000, wait_until="domcontentloaded")
        content = await page.content()
        # Emails
        for match in re.findall(EMAIL_REGEX, content):
            if not match.endswith('.png') and not match.endswith('.jpg'):
                emails.add(match)
        # Socials
        for match in re.finditer(SOCIAL_REGEX, content):
            socials.add(match.group(0))
        # About snippet (grab first 3 paragraphs)
        paragraphs = await page.locator('p').all_text_contents()
        valid_p = [p.strip() for p in paragraphs if len(p.strip()) > 30]
        about_snippet = " ".join(valid_p[:3])[:500]
    except Exception:
        pass
    finally:
        await page.close()
    
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
            rating_el = page.locator('div[aria-label*="stars"]').first
            if await rating_el.count() > 0:
                aria_label = await rating_el.get_attribute("aria-label")
                if aria_label:
                    rating = aria_label.split(" ")[0]
            review_button = page.locator('button[aria-label*="reviews"]').first
            if await review_button.count() > 0:
                review_text = await review_button.text_content()
                if review_text:
                    reviews = review_text.replace("reviews", "").replace("review", "").replace("(", "").replace(")", "").strip()
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
            "is_claimed": is_claimed,
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
