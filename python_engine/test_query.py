import asyncio
from scrapers.intent_dorks import expand_keyword_to_dorks
from scrapers.search_backends import web_search

kw = "geo politics websites with max accuracy rothschild india money where is the next big thing? ai?"
dorks = expand_keyword_to_dorks("linkedin", "linkedin.com", kw)
print("Dorks:")
for d in dorks:
    print(d)

