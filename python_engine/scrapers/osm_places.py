"""
OpenStreetMap Places source — a free, no-API-key, no-billing alternative to the
Google Places API for finding local-business leads.

Data flow:
  1. Nominatim geocodes the user's location string -> a bounding box.
  2. Overpass API returns business POIs inside that box, matched to OSM tags
     derived from the user's niche (restaurant, dentist, gym, boutique, …).
  3. Each POI's own website is optionally fetched to harvest emails / socials /
     an "about" snippet (the same shared extractors every other scraper uses).

Everything here rides on OpenStreetMap open data (ODbL). We are deliberately
polite: a real identifying User-Agent, one geocode call, a single Overpass query
with a server-side timeout, mirror fallover, and bounded website enrichment. No
platform Terms of Service are bypassed and no login-walled data is touched.

The yielded lead dict matches the Google-Maps lead shape (name, phone, website,
address, emails_found, …) so the rest of the pipeline (scoring, CRM, export)
treats OSM leads identically — `kind="business_listing"` routes them through the
business scorer in src/lib/nim.ts.
"""

import asyncio
import os
import re
from typing import AsyncGenerator, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from scrapers.extract import extract_emails, extract_socials, valid_phone
from scrapers.search_backends import web_search, AllBackendsThrottled

# ── Politeness / identity ──────────────────────────────────────────────────
# Nominatim's usage policy REQUIRES a genuine, identifying User-Agent (ideally
# with a contact). This is a compliance requirement, not attribution risk —
# an honest UA is exactly what keeps the free tier open to us. Override via env.
_CONTACT = os.getenv("OSM_CONTACT", "").strip()
USER_AGENT = os.getenv("OSM_USER_AGENT", "").strip() or (
    f"LeadResearch/1.0 ({_CONTACT})" if _CONTACT else "LeadResearch/1.0 (+localhost)"
)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Public Overpass mirrors, tried in order. If one is overloaded (429/504) we
# fail over to the next instead of surfacing an error to the user.
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# ── Niche -> OSM tag mapping ────────────────────────────────────────────────
# Each entry: (trigger keywords, list of Overpass tag selectors). A niche is
# matched by substring against the keywords; every matched selector is unioned
# into the query. Kept broad because LaunchPixel-style agencies sell to almost
# any local business that lacks a strong web presence.
NICHE_TAGS: List[Tuple[List[str], List[str]]] = [
    (["restaurant", "dining", "eatery", "food"], ['["amenity"="restaurant"]', '["amenity"="fast_food"]']),
    (["cafe", "coffee", "bakery", "patisserie"], ['["amenity"="cafe"]', '["shop"="bakery"]']),
    (["bar", "pub", "brewery", "nightclub"], ['["amenity"="bar"]', '["amenity"="pub"]', '["amenity"="nightclub"]']),
    (["hotel", "resort", "lodge", "hospitality", "guest house", "guesthouse", "stay"],
     ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="motel"]']),
    (["travel", "tour", "tourism"], ['["shop"="travel_agency"]', '["office"="travel_agent"]']),
    (["dentist", "dental"], ['["amenity"="dentist"]', '["healthcare"="dentist"]']),
    (["doctor", "clinic", "hospital", "medical", "physician", "healthcare"],
     ['["amenity"="doctors"]', '["amenity"="clinic"]', '["amenity"="hospital"]', '["healthcare"]']),
    (["pharmacy", "chemist", "medical store"], ['["amenity"="pharmacy"]']),
    (["gym", "fitness", "crossfit", "yoga", "workout"], ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]']),
    (["salon", "spa", "beauty", "parlour", "parlor", "hairdresser", "barber"],
     ['["shop"="hairdresser"]', '["shop"="beauty"]', '["leisure"="spa"]']),
    (["lawyer", "legal", "attorney", "advocate", "law firm"], ['["office"="lawyer"]']),
    (["accountant", "accounting", "ca ", "chartered accountant", "bookkeep", "tax"], ['["office"="accountant"]', '["office"="tax_advisor"]']),
    (["real estate", "realtor", "property", "estate agent", "broker"], ['["office"="estate_agent"]']),
    (["insurance"], ['["office"="insurance"]']),
    (["clothing", "clothes", "apparel", "fashion", "boutique", "garment"], ['["shop"="clothes"]', '["shop"="boutique"]']),
    (["jewel", "jewellery", "jewelry", "gold"], ['["shop"="jewelry"]']),
    (["electronic", "mobile", "gadget", "computer", "laptop"], ['["shop"="electronics"]', '["shop"="mobile_phone"]', '["shop"="computer"]']),
    (["furniture", "interior", "home decor", "decor"], ['["shop"="furniture"]', '["shop"="interior_decoration"]']),
    (["car", "automobile", "automotive", "garage", "workshop", "auto repair"],
     ['["shop"="car"]', '["shop"="car_repair"]', '["shop"="car_parts"]']),
    (["grocery", "supermarket", "kirana", "store", "shop", "retail", "mart"], ['["shop"="supermarket"]', '["shop"="convenience"]', '["shop"="general"]']),
    (["school", "college", "coaching", "tuition", "institute", "academy", "education", "edtech", "training"],
     ['["amenity"="school"]', '["amenity"="college"]', '["office"="educational_institution"]']),
    (["plumber", "plumbing"], ['["craft"="plumber"]']),
    (["electrician", "electrical"], ['["craft"="electrician"]']),
    (["carpenter", "contractor", "construction", "builder", "renovation"], ['["craft"="carpenter"]', '["office"="construction_company"]']),
    (["photographer", "photography", "studio"], ['["craft"="photographer"]', '["shop"="photo"]']),
    (["florist", "flower"], ['["shop"="florist"]']),
    (["pet", "veterinary", "vet"], ['["amenity"="veterinary"]', '["shop"="pet"]']),
    (["hardware", "paint", "building material"], ['["shop"="hardware"]', '["shop"="paint"]', '["shop"="doityourself"]']),
    (["agency", "marketing", "advertising", "consult", "software", "it company",
      "startup", "saas", "digital", "design studio", "tech"],
     ['["office"="company"]', '["office"="it"]', '["office"="advertising_agency"]', '["office"="consulting"]']),
]

# Business-ish top-level keys used for the name-regex fallback when a niche
# doesn't match any known category above.
FALLBACK_KEYS = ["shop", "amenity", "office", "craft", "tourism", "leisure", "healthcare"]


def _select_tag_filters(niche: str) -> Tuple[List[str], bool]:
    """
    Return (overpass_selectors, used_fallback). Scans the niche for known
    category keywords; if none hit, builds a name-regex fallback so any niche
    still returns something plausible.
    """
    n = (niche or "").lower().strip()
    selectors: List[str] = []
    for keywords, sels in NICHE_TAGS:
        if any(kw in n for kw in keywords):
            selectors.extend(sels)
    # De-dup while preserving order.
    selectors = list(dict.fromkeys(selectors))
    if selectors:
        return selectors, False

    # Fallback: match the niche against POI names, constrained to business keys
    # so we don't drag in benches, trees, and bus stops.
    safe = re.sub(r'["\\]', "", n)[:40] or "shop"
    fallback = [f'["name"~"{safe}",i]["{key}"]' for key in FALLBACK_KEYS]
    return fallback, True


def _geocode(location: str) -> Optional[Dict]:
    """Nominatim → bounding box for a place name. Blocking; call via to_thread."""
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"q": location, "format": "jsonv2", "limit": 1, "addressdetails": 0},
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None
    if not data:
        return None
    top = data[0]
    bb = top.get("boundingbox")  # [south, north, west, east] as strings
    if not bb or len(bb) != 4:
        return None
    south, north, west, east = (float(x) for x in bb)
    return {
        "south": south, "north": north, "west": west, "east": east,
        "display_name": top.get("display_name", location),
    }


def _build_overpass_ql(selectors: List[str], bbox: Dict, out_cap: int) -> str:
    """Assemble a single Overpass QL query over the bbox for all selectors."""
    b = f'({bbox["south"]},{bbox["west"]},{bbox["north"]},{bbox["east"]})'
    # `nwr` = node|way|relation. `out center` gives ways/relations a lat/lon.
    body = "\n  ".join(f"nwr{sel}{b};" for sel in selectors)
    return f"[out:json][timeout:50];\n(\n  {body}\n);\nout center tags {out_cap};"


def _run_overpass(ql: str) -> Optional[List[Dict]]:
    """POST the query to each mirror until one answers. Blocking."""
    for url in OVERPASS_MIRRORS:
        try:
            resp = requests.post(
                url, data={"data": ql},
                headers={"User-Agent": USER_AGENT}, timeout=90,
            )
            if resp.status_code in (429, 502, 503, 504):
                continue  # mirror busy → try the next one
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except Exception:
            continue
    return None


def _addr_from_tags(t: Dict) -> str:
    parts = [
        t.get("addr:housenumber"), t.get("addr:street"), t.get("addr:suburb"),
        t.get("addr:city") or t.get("addr:town") or t.get("addr:village"),
        t.get("addr:state"), t.get("addr:postcode"),
    ]
    return ", ".join(p for p in parts if p)


def _category_from_tags(t: Dict) -> str:
    for key in ("shop", "amenity", "office", "craft", "tourism", "leisure", "healthcare"):
        if t.get(key):
            return str(t[key]).replace("_", " ")
    return "business"


def _element_to_lead(el: Dict) -> Optional[Dict]:
    t = el.get("tags", {}) or {}
    name = (t.get("name") or t.get("brand") or "").strip()
    if not name:
        return None

    lat = el.get("lat") or (el.get("center") or {}).get("lat")
    lon = el.get("lon") or (el.get("center") or {}).get("lon")

    website = (t.get("website") or t.get("contact:website") or t.get("url") or "").strip()
    phone = (t.get("phone") or t.get("contact:phone") or t.get("contact:mobile") or "").strip()
    email = (t.get("email") or t.get("contact:email") or "").strip()

    osm_type = el.get("type", "node")
    osm_id = el.get("id")
    osm_url = f"https://www.openstreetmap.org/{osm_type}/{osm_id}" if osm_id else ""
    map_url = (
        f"https://www.google.com/maps/search/?api=1&query={lat},{lon}"
        if lat and lon else ""
    )

    return {
        "name": name,
        "category": _category_from_tags(t),
        "address": _addr_from_tags(t),
        "phone": phone,
        "website": website,
        "emails_found": [email] if email else [],
        "socials": [],
        "about_snippet": "",
        # OSM has no rating/claim concept — leave unknown so scoring doesn't
        # fabricate an "unclaimed listing" angle it can't verify.
        "rating": "",
        "reviews": "",
        "is_claimed": None,
        "url": osm_url,
        "osm_url": osm_url,
        "google_maps_url": map_url,
        "platform": "osm",
        "kind": "business_listing",
        "external_id": f"osm-{osm_type}-{osm_id}" if osm_id else None,
        "lat": lat,
        "lon": lon,
    }


# Hosts that are directories / aggregators / social pages — NOT a business's own
# site. Used to reject bad "official website" candidates from web search.
_DIRECTORY_HOSTS = (
    "justdial.", "sulekha.", "indiamart.", "yelp.", "tripadvisor.", "zomato.",
    "swiggy.", "practo.", "lybrate.", "glassdoor.", "mouthshut.", "yellowpages.",
    "wikipedia.", "youtube.", "youtu.be", "google.", "goo.gl", "maps.app",
    "amazon.", "flipkart.", "bing.", "quora.", "medium.", "blogspot.", "wordpress.com",
    "apneareamein.", "asklaila.", "grotal.", "tradeindia.", "exportersindia.",
    # Real-estate / classifieds / jobs aggregators — common false positives.
    "magicbricks.", "99acres.", "housing.com", "nobroker.", "olx.", "quikr.",
    "ambitionbox.", "naukri.", "commonfloor.", "makaan.", "squareyards.",
    "dineout.", "eazydiner.", "nearbuy.", "bookmyshow.", "clustrmaps.",
)
# Social hosts — captured as socials, not treated as the "website".
_SOCIAL_HOSTS = ("facebook.", "instagram.", "linkedin.", "twitter.", "x.com", "t.me", "wa.me")

# Generic business-type / filler words that don't distinguish one business from
# another — ignored when checking whether a search hit is really this business.
_GENERIC_TOKENS = {
    "the", "and", "for", "restaurant", "cafe", "coffee", "hotel", "resort",
    "bar", "pub", "house", "clinic", "dental", "dentist", "gym", "fitness",
    "salon", "spa", "beauty", "shop", "store", "mart", "center", "centre",
    "ltd", "pvt", "private", "limited", "inc", "india", "best", "new", "hospital",
    "medical", "care", "school", "college", "academy", "institute", "services",
}


def _name_tokens(name: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", (name or "").lower())
            if len(t) >= 3 and t not in _GENERIC_TOKENS]


def _looks_relevant(name: str, url: str, title: str) -> bool:
    """
    Guard against wrong matches: require a distinctive word from the business
    name to appear in the result's domain or title. If the name is entirely
    generic (nothing distinctive to match on), don't guess — reject.
    """
    toks = _name_tokens(name)
    if not toks:
        return False
    host = urlparse(url).netloc.lower()
    hay = f"{host} {(title or '').lower()}"
    return any(t in hay for t in toks)


def _phone_from_soup(soup: "BeautifulSoup") -> Optional[str]:
    """Pull a phone from a `tel:` link — far more reliable than regex over text."""
    for a in soup.select('a[href^="tel:"]'):
        raw = a.get("href", "").replace("tel:", "").strip()
        cleaned = valid_phone(raw)
        if cleaned:
            return cleaned
    return None


def _crawl_into(lead: Dict) -> None:
    """Fetch the lead's website and merge emails/socials/phone/about in place."""
    url = lead.get("website")
    if not url:
        return
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        resp = requests.get(
            url, headers={"User-Agent": USER_AGENT},
            timeout=8, allow_redirects=True,
        )
        if resp.status_code >= 400 or not resp.text:
            return
        html = resp.text[:400_000]  # cap huge pages

        emails = set(lead.get("emails_found") or [])
        for e in extract_emails(html):
            emails.add(e)
        socials = set(lead.get("socials") or [])
        for s in extract_socials(html):
            socials.add(s)
        lead["emails_found"] = list(emails)
        lead["socials"] = list(socials)

        soup = BeautifulSoup(html, "lxml")
        if not lead.get("phone"):
            phone = _phone_from_soup(soup)
            if phone:
                lead["phone"] = phone

        meta = soup.find("meta", attrs={"name": "description"}) or soup.find(
            "meta", attrs={"property": "og:description"}
        )
        if meta and meta.get("content"):
            lead["about_snippet"] = meta["content"].strip()[:500]
        else:
            paras = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
            valid = [p for p in paras if len(p) > 40]
            lead["about_snippet"] = " ".join(valid[:3])[:500]
    except Exception:
        pass


def _discover_website(lead: Dict) -> None:
    """
    For a lead with no website, run ONE web search (Serper-first, with keyless
    failover) to find the business's own site. Directory/aggregator results are
    rejected; social pages are captured as socials instead. Best-effort — a miss
    just leaves the lead as-is. Costs ~1 Serper credit per call.
    """
    if lead.get("website"):
        return
    name = lead.get("name", "").strip()
    if not name:
        return
    # City from the tail of the address helps disambiguate common names.
    city = ""
    if lead.get("address"):
        parts = [p.strip() for p in lead["address"].split(",") if p.strip()]
        # skip a trailing PIN/zip
        cand = [p for p in parts if not p.isdigit()]
        if cand:
            city = cand[-1]
    query = f"{name} {city}".strip()
    try:
        results = web_search(query, limit=6)
    except AllBackendsThrottled:
        return
    except Exception:
        return

    socials = set(lead.get("socials") or [])
    for r in results:
        url = (r.get("url") or "").strip()
        if not url:
            continue
        host = urlparse(url).netloc.lower()
        if any(s in host for s in _SOCIAL_HOSTS):
            socials.add(url.rstrip(".,);"))
            continue
        if any(d in host for d in _DIRECTORY_HOSTS):
            continue
        if not _looks_relevant(name, url, r.get("title", "")):
            continue
        # First clean, relevant, non-directory, non-social result → the site.
        lead["website"] = url
        break
    lead["socials"] = list(socials)


def _enrich_lead(lead: Dict, deep: bool) -> Dict:
    """Optionally discover a missing website via search, then crawl it. Blocking."""
    if deep and not lead.get("website"):
        _discover_website(lead)
    if lead.get("website"):
        _crawl_into(lead)
    return lead


async def search_places(
    niche: str, location: str, limit: int = 20, enrich: bool = True,
    deep: bool = False,
) -> AsyncGenerator[Dict, None]:
    """
    Async generator yielding info events and business-lead dicts (NDJSON-ready).
    Mirrors the streaming contract of scrape_google_maps in main.py.
    """
    limit = max(1, min(int(limit or 20), 60))

    yield {"type": "info", "message": f"Geocoding “{location}” via OpenStreetMap…"}
    bbox = await asyncio.to_thread(_geocode, location)
    if not bbox:
        yield {"type": "error", "message": f"Couldn't locate “{location}” on OpenStreetMap. Try a more specific place name (city, region)."}
        return

    selectors, used_fallback = _select_tag_filters(niche)
    note = " (matched by name — niche not in the category map)" if used_fallback else ""
    yield {"type": "info", "message": f"Searching OpenStreetMap for “{niche}”{note}…"}

    ql = _build_overpass_ql(selectors, bbox, out_cap=limit * 4)
    elements = await asyncio.to_thread(_run_overpass, ql)
    if elements is None:
        yield {"type": "error", "message": "All OpenStreetMap Overpass mirrors are busy right now. Wait ~30s and retry."}
        return

    # Parse → dedup by name+phone → cap to limit.
    leads: List[Dict] = []
    seen = set()
    for el in elements:
        lead = _element_to_lead(el)
        if not lead:
            continue
        key = (lead["name"].lower(), lead.get("phone", ""))
        if key in seen:
            continue
        seen.add(key)
        leads.append(lead)
        if len(leads) >= limit:
            break

    if not leads:
        yield {"type": "info", "message": f"No “{niche}” businesses found in that area on OpenStreetMap. Try a broader niche or nearby city."}
        return

    if not enrich:
        yield {"type": "info", "message": f"Found {len(leads)} businesses. Streaming…"}
        for lead in leads:
            yield lead
        return

    # Deep mode fills missing websites via one web search each (Serper-first).
    # Warn up-front how many lookups that will cost so credit spend is visible.
    missing_sites = sum(1 for l in leads if not l.get("website"))
    if deep and missing_sites:
        yield {"type": "info", "message": f"Found {len(leads)} businesses. Deep contact search on {missing_sites} without a listed site (~{missing_sites} search credits)…"}
    else:
        yield {"type": "info", "message": f"Found {len(leads)} businesses. Enriching contact info…"}

    # Bounded-concurrency enrichment; stream each as it finishes. Deep mode runs
    # a touch narrower to stay under search-API per-second rate limits.
    sem = asyncio.Semaphore(3 if deep else 6)

    async def _enrich(lead: Dict) -> Dict:
        async with sem:
            return await asyncio.to_thread(_enrich_lead, lead, deep)

    tasks = [asyncio.create_task(_enrich(l)) for l in leads]
    for coro in asyncio.as_completed(tasks):
        try:
            yield await coro
        except Exception:
            continue
