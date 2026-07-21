"""
Expand a base keyword into targeted "buyer-intent" search dorks, per platform.

The goal is precision, not volume: surface people/orgs actively trying to BUY a
service, and steer engines away from the sellers, job-seekers, aggregator pages
and generic content that pollute a naive `site:domain "keyword"` search.

Two layers of filtering work together:
  1. Positive intent phrases here (per platform) bias the query toward buyers.
  2. Negative `-inurl:` / `-word` operators here trim the worst aggregator pages
     for engines that honour them (Google/Serper/Bing); google_dork.py then does
     a hard URL/title post-filter so DuckDuckGo/Yahoo results are cleaned too.

Idea lineage: the decision-maker targeting borrows OpenOutreach's ICP approach.
"""
from typing import List

# ── Per-platform buyer-intent phrase sets ─────────────────────────────────────
# Each entry is appended to `site:domain "keyword"` as an extra constraint.
GENERAL_INTENT_SUFFIXES = [
    '("looking for" OR "need a" OR "need an")',
    '"can anyone recommend"',
    '"any recommendations"',
    '"need help with"',
    '("who can help" OR "help me find")',
]

LINKEDIN_INTENT_SUFFIXES = [
    '("we are hiring" OR "we\'re hiring" OR "looking to hire")',
    '"can anyone recommend"',
    '"looking for recommendations"',
    '"need help with"',
    # Decision-maker targeting (OpenOutreach ICP idea): the person who can buy.
    '("founder" OR "CEO" OR "owner" OR "co-founder" OR "head of" OR "director")',
]

UPWORK_INTENT_SUFFIXES = [
    '"budget"',
    '("looking for an expert" OR "need someone to")',
    '"hiring"',
    '("fixed price" OR "hourly")',
]

# Quora buyers ask questions seeking a recommendation/vendor.
QUORA_INTENT_SUFFIXES = [
    '("which is the best" OR "what is the best")',
    '("can someone recommend" OR "can anyone suggest")',
    '("how do I find" OR "where can I find")',
    '"looking for recommendations"',
]

# X / Twitter buyers post short asks.
TWITTER_INTENT_SUFFIXES = [
    '"DM me"',
    '("any recommendations" OR "recommendations for")',
    '("looking for" OR "need a")',
    '"anyone know"',
]

# Reddit — subreddits full of "hire us" asks.
REDDIT_INTENT_SUFFIXES = [
    '("looking for" OR "need a" OR "recommendations")',
    '"can anyone recommend"',
    '"hire"',
    '"help me find"',
]

# Instagram / Facebook — local businesses that themselves are the lead (agency
# is selling TO them), so bias toward business profiles with contact intent.
SOCIAL_BIZ_SUFFIXES = [
    '("DM for" OR "contact us" OR "book now" OR "enquiries")',
    '("owner" OR "founder")',
]

# Indian B2B directories (Justdial / IndiaMART) — the listing IS the lead. Don't
# force buyer-intent phrases; just widen with the base + a service qualifier.
DIRECTORY_SUFFIXES = [
    '("contact" OR "phone" OR "address")',
]

# ── Negative operators to trim aggregator / noise pages per domain ────────────
# Only applied to engines that honour `-inurl:`; harmless to others.
NEGATIVE_OPERATORS = {
    "linkedin.com": "-inurl:jobs -inurl:/directory/ -inurl:/learning/ -inurl:/pulse/topics",
    "quora.com": "-inurl:/profile/ -inurl:/topic/",
    "justdial.com": "",
    "indiamart.com": "",
    "upwork.com": "-inurl:/freelancers/ -inurl:/hire/",
    "instagram.com": "-inurl:/explore/ -inurl:/reels/",
    "facebook.com": "-inurl:/watch/ -inurl:/hashtag/",
}


def _suffixes_for(platform_lower: str) -> List[str]:
    if "upwork" in platform_lower:
        return UPWORK_INTENT_SUFFIXES
    if "linkedin" in platform_lower:
        return LINKEDIN_INTENT_SUFFIXES
    if "quora" in platform_lower:
        return QUORA_INTENT_SUFFIXES
    if "twitter" in platform_lower or platform_lower == "x":
        return TWITTER_INTENT_SUFFIXES
    if "reddit" in platform_lower:
        return REDDIT_INTENT_SUFFIXES
    if "instagram" in platform_lower or "facebook" in platform_lower:
        return SOCIAL_BIZ_SUFFIXES
    if "justdial" in platform_lower or "indiamart" in platform_lower:
        return DIRECTORY_SUFFIXES
    return GENERAL_INTENT_SUFFIXES


def expand_keyword_to_dorks(platform: str, site_domain: str, keyword: str) -> List[str]:
    """
    Given a platform, its site domain and a keyword, return an ordered list of
    dork queries — most-targeted (intent-qualified) first, broad base query last.
    """
    platform_lower = platform.lower()
    suffixes = _suffixes_for(platform_lower)
    neg = NEGATIVE_OPERATORS.get(site_domain, "")

    # Long/complex phrases don't survive exact-quoting; short ones benefit from it.
    is_complex = len(keyword.split()) > 3 or "?" in keyword
    kw_formatted = f'"{keyword}"' if not is_complex else keyword

    def build(constraint: str = "") -> str:
        parts = [f"site:{site_domain}", kw_formatted]
        if constraint:
            parts.append(constraint)
        if neg:
            parts.append(neg)
        return " ".join(parts).strip()

    dorks: List[str] = []
    seen = set()
    for suffix in suffixes:
        q = build(suffix)
        if q not in seen:
            seen.add(q)
            dorks.append(q)
    # Broad base query last, to backfill once the intent-qualified ones are spent.
    base = build()
    if base not in seen:
        dorks.append(base)

    return dorks
