"""
Expands a base keyword into multiple highly-targeted Google Dork queries
aimed at finding buyer-intent posts.
"""
from typing import List

GENERAL_INTENT_SUFFIXES = [
    '"DM me"',
    '"looking to hire"',
    '"need an agency"',
    '"have a budget"',
    '"recommendations for"',
    '"looking for a freelancer"',
    '"can anyone recommend"'
]

UPWORK_INTENT_SUFFIXES = [
    '"budget"',
    '"looking for expert"',
    '"need someone to"',
    '"hiring"'
]

LINKEDIN_INTENT_SUFFIXES = [
    '"hiring"',
    '"looking for recommendations"',
    '"can anyone recommend"',
    '"need help with"'
]

def expand_keyword_to_dorks(platform: str, site_domain: str, keyword: str) -> List[str]:
    """
    Given a platform name, site domain, and a base keyword, returns a list
    of full Google Dork queries aimed at high buyer-intent posts.
    """
    platform_lower = platform.lower()
    
    if "upwork" in platform_lower:
        suffixes = UPWORK_INTENT_SUFFIXES
    elif "linkedin" in platform_lower:
        suffixes = LINKEDIN_INTENT_SUFFIXES
    else:
        suffixes = GENERAL_INTENT_SUFFIXES
        
    dorks = []
    
    # First, append the highly targeted suffix queries
    for suffix in suffixes:
        dorks.append(f'site:{site_domain} "{keyword}" {suffix}')
        
    # Finally, append the base keyword query without a specific suffix 
    # to catch any remaining leads after specific intents are exhausted.
    dorks.append(f'site:{site_domain} "{keyword}"')
        
    return dorks
