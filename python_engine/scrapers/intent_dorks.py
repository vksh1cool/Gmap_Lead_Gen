"""
Expands a base keyword into multiple highly-targeted Google Dork queries
aimed at finding buyer-intent posts.

Intent suffixes are sourced from the LaunchPixel ICP (scrapers/icp.py) so the
dorks hunt for signals that map to LaunchPixel's actual services — website
builds/redesigns, e-commerce, branding, SEO, apps, AI automation — instead of
generic "looking to hire" chatter.
"""
from typing import List

from scrapers.icp import intent_phrases_for

# General fallback — kept broad and buyer-shaped for any platform not given a
# tailored set by the ICP layer.
GENERAL_INTENT_SUFFIXES = [
    '"DM me"',
    '"looking to hire"',
    '"need an agency"',
    '"recommendations for"',
    '"can anyone recommend"',
]

# Hard cap so a single keyword doesn't fan out into dozens of search-backend
# calls (which burns Serper credits / trips keyless rate-limits).
MAX_DORKS_PER_KEYWORD = 8


def expand_keyword_to_dorks(platform: str, site_domain: str, keyword: str) -> List[str]:
    """
    Given a platform name, site domain, and a base keyword, returns a list
    of full Google Dork queries aimed at high buyer-intent posts.
    """
    # LaunchPixel-tuned, platform-aware intent phrases (falls back to general).
    suffixes = intent_phrases_for(platform) or GENERAL_INTENT_SUFFIXES
    suffixes = suffixes[: MAX_DORKS_PER_KEYWORD - 1]

    dorks = []
    # For long, complex sentences or questions, exact-phrase quotes 
    # will yield 0 results. If it's short, exact-phrase is better.
    is_complex = len(keyword.split()) > 3 or "?" in keyword
    kw_formatted = f'"{keyword}"' if not is_complex else keyword
    
    # First, append the highly targeted suffix queries
    for suffix in suffixes:
        dorks.append(f'site:{site_domain} {kw_formatted} {suffix}')
        
    # Finally, append the base keyword query without a specific suffix 
    # to catch any remaining leads after specific intents are exhausted.
    dorks.append(f'site:{site_domain} {kw_formatted}')
        
    return dorks
