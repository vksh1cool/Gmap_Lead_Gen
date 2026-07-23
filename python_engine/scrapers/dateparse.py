"""
Freshness utilities — the difference between a 2-hour-old lead (gold) and a
2-year-old one (already contacted by everyone).

Search engines and APIs hand us dates in wildly different shapes:
  • Serper/Google  → "2 hours ago", "3 days ago", "yesterday", "Mar 3, 2026"
  • native APIs     → ISO 8601 / unix epoch (handled at the source)

`parse_date()` normalises any of these into (iso_string, age_hours) so the
whole pipeline can sort newest-first and hard-drop anything outside the user's
requested window. Everything is best-effort: an unparseable date returns
(None, None) and the lead is *kept* (we never throw away a lead just because we
couldn't read its timestamp — we only rank it below dated ones).

Freshness codes are single letters, matching Google's `qdr:` time filter so
Serper honours them natively: 'h' past hour · 'd' past 24h · 'w' past week ·
'm' past month · 'y' past year · None/'any' = no filter.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

# freshness code → max age in hours (None ⇒ unbounded)
FRESHNESS_HOURS = {
    "h": 1,
    "d": 24,
    "w": 24 * 7,
    "m": 24 * 30,
    "y": 24 * 365,
}

_REL_UNIT_HOURS = {
    "second": 1 / 3600, "sec": 1 / 3600,
    "minute": 1 / 60, "min": 1 / 60,
    "hour": 1, "hr": 1,
    "day": 24,
    "week": 24 * 7, "wk": 24 * 7,
    "month": 24 * 30, "mon": 24 * 30,
    "year": 24 * 365, "yr": 24 * 365,
}

# "2 hours ago", "1 day ago", "3 wks ago", "an hour ago"
_REL_RE = re.compile(
    r"(?:(\d+)|an?|a\s+few)\s*"
    r"(second|sec|minute|min|hour|hr|day|week|wk|month|mon|year|yr)s?\s*ago",
    re.IGNORECASE,
)

# Absolute formats Google emits, most specific first.
_ABS_FORMATS = (
    "%b %d, %Y",   # Mar 3, 2026
    "%d %b %Y",    # 3 Mar 2026
    "%B %d, %Y",   # March 3, 2026
    "%Y-%m-%d",    # 2026-03-03
    "%d/%m/%Y",
    "%m/%d/%Y",
)


def normalize_freshness(code: Optional[str]) -> Optional[str]:
    """Coerce any UI value ('24h', 'past week', 'd', 'any') into a canonical code."""
    if not code:
        return None
    c = str(code).strip().lower()
    if c in ("any", "all", "none", ""):
        return None
    if c in FRESHNESS_HOURS:
        return c
    # Friendly aliases from the UI selector.
    alias = {
        "hour": "h", "1h": "h", "past hour": "h", "hourly": "h",
        "24h": "d", "day": "d", "today": "d", "past 24 hours": "d", "past day": "d",
        "week": "w", "7d": "w", "past week": "w",
        "month": "m", "30d": "m", "past month": "m",
        "year": "y", "past year": "y",
    }
    return alias.get(c)


def parse_date(raw: Optional[str], now: Optional[datetime] = None) -> Tuple[Optional[str], Optional[float]]:
    """Return (iso_utc_string, age_hours) for a raw date string, or (None, None)."""
    if not raw or not isinstance(raw, str):
        return None, None
    now = now or datetime.now(timezone.utc)
    s = raw.strip()

    # Already ISO? (native scrapers give us this)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = (now - dt).total_seconds() / 3600
        return dt.astimezone(timezone.utc).isoformat(), max(age, 0.0)
    except (ValueError, TypeError):
        pass

    low = s.lower()
    if low in ("just now", "moments ago", "now"):
        return now.isoformat(), 0.0
    if low == "yesterday":
        dt = now - timedelta(days=1)
        return dt.isoformat(), 24.0

    m = _REL_RE.search(low)
    if m:
        qty = int(m.group(1)) if m.group(1) else 1
        unit_h = _REL_UNIT_HOURS.get(m.group(2).lower(), None)
        if unit_h is not None:
            age = qty * unit_h
            dt = now - timedelta(hours=age)
            return dt.isoformat(), age

    for fmt in _ABS_FORMATS:
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            age = (now - dt).total_seconds() / 3600
            return dt.isoformat(), max(age, 0.0)
        except ValueError:
            continue

    return None, None


def within_freshness(age_hours: Optional[float], code: Optional[str]) -> bool:
    """True if a lead of the given age passes the freshness window.

    Undated leads (age_hours is None) always pass — we rank, never discard, them.
    """
    code = normalize_freshness(code)
    if code is None or age_hours is None:
        return True
    limit = FRESHNESS_HOURS.get(code)
    if limit is None:
        return True
    # small grace factor for relative-date rounding ("1 day ago" ≈ up to 48h)
    return age_hours <= limit * 1.5


def freshness_label(age_hours: Optional[float]) -> str:
    """Human badge text for a lead's recency."""
    if age_hours is None:
        return ""
    if age_hours < 1:
        return "🔥 <1h ago"
    if age_hours < 6:
        return f"🔥 {int(age_hours)}h ago"
    if age_hours < 24:
        return f"{int(age_hours)}h ago"
    days = age_hours / 24
    if days < 7:
        return f"{int(days)}d ago"
    if days < 30:
        return f"{int(days / 7)}w ago"
    return f"{int(days / 30)}mo ago"


def recency_key(lead: dict) -> float:
    """Sort key — smaller (fresher) first. Undated leads sort last."""
    age = lead.get("age_hours")
    if age is None:
        _iso, age = parse_date(lead.get("posted_at") or lead.get("created_at"))
    return age if age is not None else float("inf")
