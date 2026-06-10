import asyncio
import logging
import json
from social_scraper import scrape_social_orchestrator

logging.basicConfig(level=logging.INFO)

async def main():
    kw = "geo politics websites with max accuracy rothschild india money where is the next big thing? ai?geo politics websites with max accuracy rothschild india money where is the next big thing? ai?"
    print(f"Testing long keyword: {kw}")
    result = await scrape_social_orchestrator("all", kw, max_leads=5)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
