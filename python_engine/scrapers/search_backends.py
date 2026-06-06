"""
Pluggable web-search backends for `site:` dorking.

Priority order (first available wins, with automatic failover):
  1. Serper.dev      — SERPER_API_KEY      (2,500 free queries, no card, Google-quality JSON) ⭐
  2. Brave Search    — BRAVE_API_KEY       (metered; grandfathered free tiers still work)
  3. Google CSE      — GOOGLE_CSE_KEY + GOOGLE_CSE_CX (100/day; existing customers only)
  4. SearXNG         — SEARXNG_URL         (self-hosted or public instance, JSON API)
  5. DuckDuckGo HTML — keyless             (rate-limit-prone on a single IP)
  6. Mojeek          — keyless             (independent crawler, last-resort)

Design goals:
  - Never ban the IP: keyed APIs are ban-proof; keyless backends are paced + circuit-broken.
  - Always degrade: if one backend is throttled (429/202/403), fail over to the next.
  - Be honest: if EVERY available backend is throttled, raise AllBackendsThrottled so the
    caller can surface the "rate-limited, cooling down" dialog instead of returning silent zeros.
"""

import os
import time
import random
import logging
import urllib.parse
from typing import List, Dict, Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]

# Per-backend cooldown after a throttle, so we stop hammering a flagged endpoint.
# Keyed APIs rarely trip this; keyless ones cool down for minutes.
_backend_cooldown: Dict[str, float] = {}
KEYLESS_COOLDOWN_S = 15 * 60   # 15 min rest for a throttled keyless backend
KEYED_COOLDOWN_S = 60          # keyed APIs: brief pause on a transient 429


class AllBackendsThrottled(Exception):
    """Raised when every configured search backend is rate-limited/unavailable."""
    def __init__(self, tried: List[str], soonest_retry_s: int):
        self.tried = tried
        self.soonest_retry_s = soonest_retry_s
        super().__init__(f"All search backends throttled: {tried}; retry in ~{soonest_retry_s}s")


def _cooling(name: str) -> bool:
    until = _backend_cooldown.get(name, 0)
    return time.time() < until


def _cool_down(name: str, seconds: int) -> None:
    _backend_cooldown[name] = time.time() + seconds
    logger.warning("Search backend '%s' cooling down for %ds", name, seconds)


def _headers() -> dict:
    return {"User-Agent": random.choice(USER_AGENTS), "Accept-Language": "en-US,en;q=0.9"}


# ── individual backends ───────────────────────────────────────────────────────
# Each returns List[{title, url, snippet}] or raises _Throttled to trigger failover.

class _Throttled(Exception):
    pass


def _serper(query: str, limit: int) -> Optional[List[Dict]]:
    from .serper_keys import key_manager

    if not key_manager.active_key():
        return None  # no usable keys in the pool → not configured

    # Rotate through the pool: a 403 ("Not enough credits") exhausts the current
    # key and we immediately retry with the next one. A 429 is the per-second rate
    # limit (not exhaustion) → bubble up as a throttle for the backend cooldown.
    attempts = 0
    while attempts < 12:
        attempts += 1
        key = key_manager.active_key()
        if not key:
            logger.warning("All Serper keys exhausted — add a new key in Settings.")
            return None  # fall through to the next backend
        try:
            r = requests.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": key, "Content-Type": "application/json"},
                json={"q": query, "num": min(max(limit, 10), 30)},
                timeout=20,
            )
            if r.status_code == 429:
                raise _Throttled()
            if r.status_code in (401, 402, 403):
                # 401 invalid / 402 payment / 403 out-of-credits → drop this key, rotate.
                key_manager.mark_exhausted(key, reason=f"HTTP {r.status_code}: {r.text[:80]}")
                logger.warning("Serper key %s…%s exhausted/invalid (%d) — rotating",
                               key[:6], key[-4:], r.status_code)
                continue
            r.raise_for_status()
            out = []
            for it in r.json().get("organic", []):
                url = it.get("link", "")
                if url:
                    out.append({"title": it.get("title", ""), "url": url, "snippet": it.get("snippet", "")})
            return out
        except _Throttled:
            raise
        except requests.exceptions.RequestException as exc:
            logger.warning("Serper error: %s", exc)
            return []
    return None


def _brave(query: str, limit: int) -> Optional[List[Dict]]:
    key = os.getenv("BRAVE_API_KEY")
    if not key:
        return None
    try:
        r = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": key, "Accept": "application/json"},
            params={"q": query, "count": min(max(limit, 10), 20)},
            timeout=20,
        )
        if r.status_code == 429:
            raise _Throttled()
        if r.status_code in (401, 403):
            logger.error("Brave auth failed (%d) — check BRAVE_API_KEY", r.status_code)
            return []
        r.raise_for_status()
        out = []
        for it in (r.json().get("web", {}) or {}).get("results", []):
            url = it.get("url", "")
            if url:
                out.append({"title": it.get("title", ""), "url": url, "snippet": it.get("description", "")})
        return out
    except _Throttled:
        raise
    except requests.exceptions.RequestException as exc:
        logger.warning("Brave error: %s", exc)
        return []


def _google_cse(query: str, limit: int) -> Optional[List[Dict]]:
    key = os.getenv("GOOGLE_CSE_KEY")
    cx = os.getenv("GOOGLE_CSE_CX")
    if not key or not cx:
        return None
    try:
        r = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": key, "cx": cx, "q": query, "num": min(max(limit, 1), 10)},
            timeout=20,
        )
        if r.status_code == 429:
            raise _Throttled()
        if r.status_code in (401, 403):
            logger.error("Google CSE auth/quota failed (%d)", r.status_code)
            return []
        r.raise_for_status()
        out = []
        for it in r.json().get("items", []):
            url = it.get("link", "")
            if url:
                out.append({"title": it.get("title", ""), "url": url, "snippet": it.get("snippet", "")})
        return out
    except _Throttled:
        raise
    except requests.exceptions.RequestException as exc:
        logger.warning("Google CSE error: %s", exc)
        return []


def _searxng(query: str, limit: int) -> Optional[List[Dict]]:
    base = os.getenv("SEARXNG_URL")
    if not base:
        return None
    try:
        r = requests.get(
            f"{base.rstrip('/')}/search",
            params={"q": query, "format": "json", "language": "en-US"},
            headers=_headers(), timeout=20,
        )
        if r.status_code in (429, 202):
            raise _Throttled()
        r.raise_for_status()
        out = []
        for it in r.json().get("results", [])[:limit * 2]:
            url = it.get("url", "")
            if url:
                out.append({"title": it.get("title", ""), "url": url, "snippet": it.get("content", "")})
        return out
    except _Throttled:
        raise
    except (requests.exceptions.RequestException, ValueError) as exc:
        logger.warning("SearXNG error: %s", exc)
        return []


def _decode_ddg_href(href: str) -> str:
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    if "duckduckgo.com/l/" in href:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        if "uddg" in qs:
            return urllib.parse.unquote(qs["uddg"][0])
    return href


def _ddg(query: str, limit: int) -> List[Dict]:
    try:
        r = requests.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query, "kl": "us-en"},
            headers={**_headers(), "Referer": "https://duckduckgo.com/"},
            timeout=20,
        )
        if r.status_code in (202, 429, 403):
            raise _Throttled()
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        out = []
        for res in soup.select("div.result, div.web-result"):
            cls = " ".join(res.get("class", []))
            if "result--ad" in cls:
                continue
            a = res.select_one("a.result__a")
            if not a:
                continue
            url = _decode_ddg_href(a.get("href", ""))
            if not url or "duckduckgo.com" in url:
                continue
            snip = res.select_one(".result__snippet")
            out.append({"title": a.get_text(strip=True), "url": url,
                        "snippet": snip.get_text(" ", strip=True) if snip else ""})
        return out
    except _Throttled:
        raise
    except requests.exceptions.RequestException as exc:
        logger.warning("DDG error: %s", exc)
        return []


def _mojeek(query: str, limit: int) -> List[Dict]:
    try:
        r = requests.get("https://www.mojeek.com/search", params={"q": query},
                         headers=_headers(), timeout=20)
        if r.status_code in (429, 403):
            raise _Throttled()
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        out = []
        for li in soup.select("ul.results-standard li, li.result"):
            a = li.select_one("a.title") or li.select_one("h2 a") or li.select_one("a")
            if not a or not a.get("href", "").startswith("http"):
                continue
            snip = li.select_one("p.s")
            out.append({"title": a.get_text(strip=True), "url": a.get("href"),
                        "snippet": snip.get_text(" ", strip=True) if snip else ""})
        return out
    except _Throttled:
        raise
    except requests.exceptions.RequestException as exc:
        logger.warning("Mojeek error: %s", exc)
        return []


# Ordered registry: (name, fn, is_keyed)
_BACKENDS = [
    ("serper", _serper, True),
    ("brave", _brave, True),
    ("google_cse", _google_cse, True),
    ("searxng", _searxng, False),
    ("ddg", _ddg, False),
    ("mojeek", _mojeek, False),
]


def configured_backends() -> List[str]:
    """Names of backends that are usable right now (configured + not cooling)."""
    names = []
    for name, fn, _keyed in _BACKENDS:
        if _cooling(name):
            continue
        # keyed backends self-report None when their env var is missing
        if name in ("serper", "brave", "google_cse", "searxng"):
            if not _backend_env_present(name):
                continue
        names.append(name)
    return names


def _backend_env_present(name: str) -> bool:
    if name == "serper":
        from .serper_keys import key_manager
        return key_manager.has_active()  # any non-exhausted key in the pool
    return {
        "brave": bool(os.getenv("BRAVE_API_KEY")),
        "google_cse": bool(os.getenv("GOOGLE_CSE_KEY") and os.getenv("GOOGLE_CSE_CX")),
        "searxng": bool(os.getenv("SEARXNG_URL")),
    }.get(name, True)


def web_search(query: str, limit: int = 10, search_mode: str = "auto") -> List[Dict]:
    """
    Run `query` through the first working backend, failing over on throttle.
    Returns List[{title, url, snippet}]. Raises AllBackendsThrottled if every
    available backend is rate-limited (so the caller can show the cooldown dialog).
    A backend that returns 0 genuine results (not throttled) is treated as success.
    """
    tried = []
    threw_throttle = False
    for name, fn, keyed in _BACKENDS:
        if search_mode == "keyless" and keyed:
            continue
        if name in ("serper", "brave", "google_cse", "searxng") and not _backend_env_present(name):
            continue
        if _cooling(name):
            tried.append(f"{name}(cooling)")
            threw_throttle = True
            continue
        try:
            results = fn(query, limit)
            if results is None:  # not configured
                continue
            tried.append(name)
            logger.info("Search via '%s': %d results for %s", name, len(results), query)
            return results
        except _Throttled:
            _cool_down(name, KEYED_COOLDOWN_S if keyed else KEYLESS_COOLDOWN_S)
            tried.append(f"{name}(throttled)")
            threw_throttle = True
            continue

    if threw_throttle:
        # Everything we could try is in cooldown → signal the dialog.
        soonest = min((int(_backend_cooldown[n] - time.time()) for n in _backend_cooldown
                       if _backend_cooldown[n] > time.time()), default=KEYLESS_COOLDOWN_S)
        raise AllBackendsThrottled(tried, max(soonest, 1))

    logger.info("Search found 0 results for %s (tried: %s)", query, tried)
    return []
