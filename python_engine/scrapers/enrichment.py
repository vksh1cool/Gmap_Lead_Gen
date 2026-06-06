import asyncio
import json
import logging
from typing import List, Dict
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

# Stealth might be imported differently. Usually playwright_stealth import stealth_async
try:
    from playwright_stealth import stealth_async
except ImportError:
    # If playwright_stealth is not installed or different name, fallback to no-op
    async def stealth_async(page):
        pass

logger = logging.getLogger(__name__)

async def _enrich_single_lead(browser, lead: Dict) -> Dict:
    url = lead.get("post_url") or lead.get("website")
    if not url:
        return lead

    page = await browser.new_page()
    await stealth_async(page)
    
    # Defaults in case of failure
    enriched_lead = lead.copy()
    
    try:
        # 15s timeout, don't crash orchestrator
        response = await page.goto(url, timeout=15000, wait_until="domcontentloaded")
        
        if response and response.status in [403, 429]:
            logger.warning("Access denied or rate limited on %s (status: %s)", url, response.status)
            return lead
            
        # Give it a tiny bit of time to render JS
        await page.wait_for_timeout(2000)

        # Extract OpenGraph and meta tags
        meta_data = await page.evaluate('''() => {
            const getMeta = (name) => {
                const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                return el ? el.getAttribute('content') : null;
            };
            
            // Search JSON-LD
            let jsonLdData = null;
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (let script of scripts) {
                try {
                    let data = JSON.parse(script.textContent);
                    if (data) {
                        jsonLdData = data;
                        break;
                    }
                } catch (e) {}
            }

            // Find longest visible text block (crude heuristic)
            const textBlocks = [];
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let n;
            while(n = walk.nextNode()) {
                const parent = n.parentElement;
                if (!parent) continue;
                const tag = parent.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'head', 'meta'].includes(tag)) continue;
                
                const style = window.getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                
                const text = n.textContent.trim();
                if (text.length > 50) {
                    textBlocks.push(text);
                }
            }
            
            let longestText = "";
            if (textBlocks.length > 0) {
                longestText = textBlocks.reduce((a, b) => a.length > b.length ? a : b, "");
            }

            return {
                ogTitle: getMeta('og:title'),
                ogDescription: getMeta('og:description'),
                description: getMeta('description'),
                publishedTime: getMeta('article:published_time') || getMeta('og:article:published_time'),
                jsonLd: jsonLdData,
                longestText: longestText
            };
        }''')

        # Combine logic to pick best text for post_content
        content_candidates = []
        if meta_data.get('ogDescription'):
            content_candidates.append(meta_data['ogDescription'])
        elif meta_data.get('description'):
            content_candidates.append(meta_data['description'])
            
        longest = meta_data.get('longestText')
        if longest and len(longest) > 150:
            content_candidates.append(longest)
            
        # Also JSON-LD extraction for article body or text
        json_ld = meta_data.get('jsonLd')
        if json_ld and isinstance(json_ld, dict):
            article_body = json_ld.get('articleBody') or json_ld.get('text') or json_ld.get('description')
            if article_body and isinstance(article_body, str):
                content_candidates.append(article_body)
                
            date_pub = json_ld.get('datePublished') or json_ld.get('uploadDate')
            if date_pub and isinstance(date_pub, str):
                enriched_lead['posted_at'] = date_pub

        if meta_data.get('publishedTime'):
            enriched_lead['posted_at'] = meta_data['publishedTime']

        # Pick the longest available candidate for content
        if content_candidates:
            best_content = max(content_candidates, key=len)
            enriched_lead['post_content'] = best_content
            
            # If the snippet was short, override about_snippet too
            if len(enriched_lead.get('about_snippet', '')) < 150:
                # keep it brief for about_snippet, but full for post_content
                enriched_lead['about_snippet'] = best_content[:300] + ('...' if len(best_content) > 300 else '')

    except PlaywrightTimeoutError:
        logger.warning("Timeout fetching %s", url)
    except Exception as e:
        logger.warning("Error enriching %s: %s", url, str(e))
    finally:
        await page.close()
        
    return enriched_lead

async def enrich_leads(leads: List[Dict]) -> List[Dict]:
    """
    Takes a list of leads, visits their URLs with playwright-stealth,
    extracts OG tags, meta tags, JSON-LD, and main text, and returns
    the enriched leads.
    """
    if not leads:
        return leads

    logger.info("Enriching %d leads via Playwright...", len(leads))
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            tasks = [_enrich_single_lead(browser, lead) for lead in leads]
            enriched = await asyncio.gather(*tasks, return_exceptions=False)
            await browser.close()
            return list(enriched)
    except Exception as e:
        logger.error("Failed to start Playwright for enrichment: %s", str(e))
        return leads
