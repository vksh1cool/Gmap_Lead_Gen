"""
LaunchPixel Ideal Customer Profile (ICP) — the single source of truth for who we
sell to and what buying signals to hunt for.

LaunchPixel (launchpixel.in) is a full-stack digital agency: web development &
systems, UI/UX + motion, brand strategy & identity, SEO / performance marketing,
e-commerce, mobile apps, and AI automation. It serves ambitious brands in
e-commerce, EdTech, agri, travel/booking, SaaS, and education — India-based,
remote worldwide.

The scoring layer (src/lib/icp.ts) mirrors these definitions on the Node side.
Keep the two in rough sync when you edit either.
"""

# Buyer-intent phrases grouped by the LaunchPixel service they map to. Used to
# expand `site:` dorks toward people actively shopping for these services rather
# than generic chatter. Phrases are kept short so exact-match search stays broad.
SERVICE_INTENT = {
    "web_development": [
        '"need a website"',
        '"website redesign"',
        '"revamp our website"',
        '"looking for a web developer"',
        '"web design agency"',
        '"build a website for"',
    ],
    "ecommerce": [
        '"Shopify developer"',
        '"build an online store"',
        '"ecommerce website"',
        '"migrate to Shopify"',
        '"WooCommerce developer"',
    ],
    "branding": [
        '"need a rebrand"',
        '"brand identity"',
        '"logo redesign"',
        '"new brand identity"',
    ],
    "seo_marketing": [
        '"not ranking on Google"',
        '"improve our SEO"',
        '"need more traffic"',
        '"SEO agency"',
        '"performance marketing"',
    ],
    "mobile_app": [
        '"mobile app developer"',
        '"build an app"',
        '"need an MVP"',
        '"iOS and Android app"',
    ],
    "ai_automation": [
        '"AI automation"',
        '"AI chatbot"',
        '"automate our workflow"',
        '"automate customer support"',
    ],
}

# High-signal industries LaunchPixel targets. Used to bias/annotate leads.
TARGET_INDUSTRIES = [
    "ecommerce", "edtech", "education", "saas", "agriculture",
    "travel", "booking", "hospitality", "d2c", "startup",
]

# A flat, de-duplicated list of every intent phrase — the default expansion.
ALL_INTENT_PHRASES = [p for phrases in SERVICE_INTENT.values() for p in phrases]


def intent_phrases_for(platform: str) -> list:
    """
    Return the buyer-intent suffixes best suited to a platform. Job boards and
    B2B directories want procurement-style phrasing; social wants the full
    service spread. Falls back to the whole set.
    """
    p = (platform or "").lower()
    if "upwork" in p or "justdial" in p or "indiamart" in p:
        return [
            '"looking for"', '"need someone to"', '"hiring"', '"budget"',
            '"Shopify developer"', '"website redesign"', '"build an app"',
        ]
    if "linkedin" in p:
        return [
            '"hiring"', '"looking for recommendations"', '"can anyone recommend"',
            '"website redesign"', '"need a rebrand"',
            '("founder" OR "CEO" OR "owner" OR "co-founder" OR "head of" OR "director")',
        ]
    return ALL_INTENT_PHRASES
