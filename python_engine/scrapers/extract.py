"""
Shared contact-extraction helpers.

Single source of truth for email / phone / social harvesting so every scraper
(Google Maps crawl, HTTrack mirror, social enrichment) filters identically.
"""

import re

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_REGEX = re.compile(r"(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d(?:[\d\s.-]{6,16}\d)")
SOCIAL_REGEX = re.compile(
    r"https?://(?:www\.)?(?:facebook|fb|twitter|x|linkedin|instagram|youtube|youtu|tiktok|pinterest|t\.me|wa\.me|threads|github)\.(?:com|me|be|net)/[^\s\"'<>)]+",
    re.IGNORECASE,
)

# Emails matching these substrings are template/library noise, tracking pixels,
# asset filenames, or placeholders — never a real lead.
EMAIL_BLOCKLIST = (
    "sentry", "wixpress", "example.com", "example.org", "yourdomain", "domain.com",
    "email.com", "sentry.io", "wix.com", "godaddy", "schema.org", "w3.org",
    "cloudflare", "googleapis", "gstatic", "jquery", "bootstrap", "@2x", "@3x",
    "placeholder", "yourname", "your-email", "test@test", "user@", "name@",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "core-js", "polyfill",
)

_AT_PATTERNS = [
    (re.compile(r"\s*[\(\[\{]\s*at\s*[\)\]\}]\s*", re.IGNORECASE), "@"),
    (re.compile(r"\s+at\s+", re.IGNORECASE), "@"),
]
_DOT_PATTERNS = [
    (re.compile(r"\s*[\(\[\{]\s*dot\s*[\)\]\}]\s*", re.IGNORECASE), "."),
    (re.compile(r"\s+dot\s+", re.IGNORECASE), "."),
]


def deobfuscate(text: str) -> str:
    """Turn 'name [at] domain [dot] com' → 'name@domain.com'."""
    for pat, repl in _AT_PATTERNS:
        text = pat.sub(repl, text)
    for pat, repl in _DOT_PATTERNS:
        text = pat.sub(repl, text)
    return text


def valid_email(email: str) -> bool:
    e = email.lower()
    if any(bad in e for bad in EMAIL_BLOCKLIST):
        return False
    local = e.split("@", 1)[0]
    if len(local) > 40:  # hash-like asset filename slipping through
        return False
    return True


def valid_phone(raw: str):
    """Return a cleaned phone string if plausible, else None."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 7 or len(digits) > 15:
        return None
    if len(set(digits)) <= 1:  # 0000000 / 1111111
        return None
    return raw.strip()


def extract_emails(text: str, deobf: bool = True) -> list:
    """Extract & filter emails from raw HTML/text (with de-obfuscation)."""
    src = deobfuscate(text) if deobf else text
    out = []
    seen = set()
    for m in EMAIL_REGEX.findall(src):
        e = m.strip()
        if e.lower() not in seen and valid_email(e):
            seen.add(e.lower())
            out.append(e)
    return out


def extract_socials(text: str) -> list:
    out, seen = [], set()
    for m in SOCIAL_REGEX.finditer(text):
        url = m.group(0).rstrip(".,);")
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out
