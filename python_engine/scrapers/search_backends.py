"""
Pluggable, ban-resistant web-search backends for `site:` dorking.

Priority order (first that yields results wins; automatic failover):
  KEYED  (ban-proof, tried first in `auto` mode)
    1. Serper.dev      — SERPER_API_KEY(S)  (2,500 free credits, Google-quality JSON) ⭐
    2. Brave Search    — BRAVE_API_KEY
    3. Google CSE      — GOOGLE_CSE_KEY + GOOGLE_CSE_CX
    4. SearXNG         — SEARXNG_URL         (self-hosted JSON API)
  KEYLESS (rotated pool — no key needed, hardened against blocks)
    5. DuckDuckGo HTML / DuckDuckGo Lite / Yahoo / Bing / Mojeek

Robustness techniques (distilled from the tools in ../Lead_Scraping_tools_learn):
  • curl-impersonate / Scrapling → real Chrome/Safari TLS+HTTP2 fingerprints via
    curl_cffi so keyless engines stop returning 403/202 blocks. Falls back to
    plain `requests` if curl_cffi is unavailable.
  • crawlee → the keyless engines are tried in RANDOMISED order every call, so no
    single engine gets hammered from one IP; each engine has its own cooldown.
  • Scrapling → transient 429s are retried with jittered backoff before a backend
    is written off, and Serper rotates across its key pool on a hard failure.

Design goals:
  - Never ban the IP: keyed APIs are ban-proof; keyless ones are impersonated,
    rotated, paced and circuit-broken.
  - Always degrade: a throttled/blocked backend fails over to the next one.
  - Be honest: only raise AllBackendsThrottled when EVERY available backend is
    genuinely blocked — a plain "0 matches" is returned as an empty list so the
    UI never shows a scary cooldown dialog for a query that simply had no hits.
"""

import os
import re
import time
import random
import logging
import urllib.parse
from typing import List, Dict, Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ── Stealth HTTP layer (curl_cffi browser impersonation) ──────────────────────
# The single biggest anti-ban upgrade: identical TLS/JA3 + HTTP2 fingerprints to
# a real browser. Without it, keyless search engines fingerprint the Python TLS
# stack instantly and return 202/403. With it, DuckDuckGo/Yahoo answer 200.
try:
    from curl_cffi import requests as _cffi  # type: ignore
    _HAS_CFFI = True
except Exception:  # pragma: no cover - optional dependency
    _HAS_CFFI = False
    logger.info("curl_cffi not installed — keyless search falls back to plain requests "
                "(more block-prone). `pip install curl_cffi` for ban-proof keyless mode.")

# curl_cffi impersonation targets that are known-good on recent builds.
_IMPERSONATE = ["chrome124", "chrome120", "chrome116", "safari17_0", "edge101"]

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]


def _headers() -> dict:
    return {"User-Agent": random.choice(USER_AGENTS), "Accept-Language": "en-US,en;q=0.9"}


def _fetch(method: str, url: str, **kw):
    """One stealth HTTP call. Uses curl_cffi with a rotating browser fingerprint;
    transparently falls back to `requests` if curl_cffi is missing or errors.

    Adds two scale features that are invisible when unconfigured:
      • per-domain AutoThrottle pacing (never bursts a host into a ban)
      • rotating proxy pool with health tracking (SCRAPER_PROXIES env)

    Accepts the usual requests-style kwargs (params, data, json, headers, timeout).
    """
    from .throttle import autothrottle
    from .proxy_pool import proxy_pool

    timeout = kw.pop("timeout", 20)
    autothrottle.wait(url)                      # polite per-domain pacing
    proxy = proxy_pool.get()                     # None → direct connection
    proxies = proxy_pool.as_requests_dict(proxy)

    resp = None
    try:
        if _HAS_CFFI:
            try:
                fn = _cffi.get if method == "get" else _cffi.post
                resp = fn(url, impersonate=random.choice(_IMPERSONATE),
                          timeout=timeout, proxies=proxies, **kw)
            except Exception as exc:  # network / build issue → fall through to requests
                logger.debug("curl_cffi %s failed (%s); using requests", method, exc)
        if resp is None:
            headers = kw.pop("headers", None) or {}
            headers = {**_headers(), **headers}
            fn = requests.get if method == "get" else requests.post
            resp = fn(url, headers=headers, timeout=timeout, proxies=proxies, **kw)
    except Exception:
        proxy_pool.report(proxy, ok=False)
        autothrottle.report(url, blocked=True)
        raise

    blocked = resp.status_code in (202, 403, 429, 503)
    proxy_pool.report(proxy, ok=not blocked)
    autothrottle.report(url, blocked=blocked)
    return resp


# ── Cooldowns ─────────────────────────────────────────────────────────────────
# After a throttle we rest a backend so we stop hammering a flagged endpoint.
_backend_cooldown: Dict[str, float] = {}
KEYLESS_COOLDOWN_S = 8 * 60    # rest a throttled keyless engine (others keep serving)
KEYED_COOLDOWN_S = 20          # keyed APIs: only a brief pause on a persistent 429


class AllBackendsThrottled(Exception):
    """Raised when every configured search backend is rate-limited/blocked."""
    def __init__(self, tried: List[str], soonest_retry_s: int):
        self.tried = tried
        self.soonest_retry_s = soonest_retry_s
        super().__init__(f"All search backends throttled: {tried}; retry in ~{soonest_retry_s}s")


def _cooling(name: str) -> bool:
    return time.time() < _backend_cooldown.get(name, 0)


def _cool_down(name: str, seconds: int) -> None:
    _backend_cooldown[name] = time.time() + seconds + random.uniform(0, 5)
    logger.warning("Search backend '%s' cooling down for ~%ds", name, seconds)


class _Throttled(Exception):
    """Backend signalled a rate-limit/block — trigger failover + cooldown."""
    pass


# ── Freshness windows ─────────────────────────────────────────────────────────
# A freshness code ('d'/'w'/'m'/'y') asks a backend for recent results only.
# Backends that can't honour it just ignore it — the caller's post-filtering
# and date extraction still apply.
# Serper honours 'h' (qdr:h) natively; Brave/CSE have no sub-day grain, so a
# past-hour request falls back to their finest window (1 day) and the caller's
# post-filter on the real result date does the fine cutting.
_BRAVE_FRESHNESS = {"h": "pd", "d": "pd", "w": "pw", "m": "pm", "y": "py"}
_CSE_FRESHNESS = {"h": "d1", "d": "d1", "w": "w1", "m": "m1", "y": "y1"}


# ── Keyed backends ────────────────────────────────────────────────────────────
def _serper(query: str, limit: int, freshness: Optional[str] = None) -> Optional[List[Dict]]:
    from .serper_keys import key_manager

    if not key_manager.active_key():
        return None  # no usable keys → not configured, fall through

    # Rotate through the key pool. A 403/402/401 exhausts the current key and we
    # try the next. A 429 is a transient per-second limit → short jittered backoff
    # and retry the SAME key (Scrapling-style) before giving up on the backend.
    for _ in range(12):
        key = key_manager.active_key()
        if not key:
            logger.warning("All Serper keys exhausted — add a new key in Settings.")
            return None

        rotate = False
        payload = {"q": query, "num": min(max(limit, 10), 30)}
        if freshness in ("d", "w", "m", "y"):
            payload["tbs"] = f"qdr:{freshness}"  # Google time filter via Serper
        for attempt in range(3):
            try:
                r = _fetch(
                    "post",
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": key, "Content-Type": "application/json"},
                    json=payload,
                    timeout=20,
                )
            except Exception as exc:
                logger.warning("Serper network error: %s", exc)
                return []

            if r.status_code == 429:
                if attempt < 2:
                    time.sleep(0.8 * (attempt + 1) + random.uniform(0, 0.4))
                    continue
                raise _Throttled()  # persistent per-second cap → brief cooldown
            if r.status_code in (401, 402, 403):
                key_manager.mark_exhausted(key, reason=f"HTTP {r.status_code}: {r.text[:80]}")
                logger.warning("Serper key %s…%s exhausted/invalid (%d) — rotating",
                               key[:6], key[-4:], r.status_code)
                rotate = True
                break
            try:
                r.raise_for_status()
            except Exception as exc:
                logger.warning("Serper error: %s", exc)
                return []
            data = r.json()
            # `date` is Google's own per-result date ("Mar 3, 2026" / "2 days ago")
            # — the most reliable freshness signal we can get without visiting
            # the page. google_dork.py parses it into posted_at.
            return [{"title": it.get("title", ""), "url": it.get("link", ""),
                     "snippet": it.get("snippet", ""), "date": it.get("date", "")}
                    for it in data.get("organic", []) if it.get("link")]
        if rotate:
            continue
    return None


def _brave(query: str, limit: int, freshness: Optional[str] = None) -> Optional[List[Dict]]:
    key = os.getenv("BRAVE_API_KEY")
    if not key:
        return None
    params = {"q": query, "count": min(max(limit, 10), 20)}
    if freshness in _BRAVE_FRESHNESS:
        params["freshness"] = _BRAVE_FRESHNESS[freshness]
    try:
        r = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": key, "Accept": "application/json"},
            params=params,
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
                out.append({"title": it.get("title", ""), "url": url,
                            "snippet": it.get("description", ""),
                            "date": it.get("page_age", "") or it.get("age", "")})
        return out
    except _Throttled:
        raise
    except requests.exceptions.RequestException as exc:
        logger.warning("Brave error: %s", exc)
        return []


def _google_cse(query: str, limit: int, freshness: Optional[str] = None) -> Optional[List[Dict]]:
    key = os.getenv("GOOGLE_CSE_KEY")
    cx = os.getenv("GOOGLE_CSE_CX")
    if not key or not cx:
        return None
    params = {"key": key, "cx": cx, "q": query, "num": min(max(limit, 1), 10)}
    if freshness in _CSE_FRESHNESS:
        params["dateRestrict"] = _CSE_FRESHNESS[freshness]
    try:
        r = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params=params,
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


def _searxng(query: str, limit: int, freshness: Optional[str] = None) -> Optional[List[Dict]]:
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


# ── Keyless backends (impersonated + rotated) ─────────────────────────────────
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
        r = _fetch("post", "https://html.duckduckgo.com/html/",
                   data={"q": query, "kl": "us-en"},
                   headers={"Referer": "https://duckduckgo.com/"}, timeout=20)
        if r.status_code in (202, 429, 403):
            raise _Throttled()
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        out = []
        for res in soup.select("div.result, div.web-result"):
            if "result--ad" in " ".join(res.get("class", [])):
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
    except Exception as exc:
        logger.warning("DDG error: %s", exc)
        return []


def _ddg_lite(query: str, limit: int) -> List[Dict]:
    """DuckDuckGo Lite — a separate endpoint with its own rate limit, so it keeps
    serving when the main HTML endpoint is cooling down."""
    try:
        r = _fetch("post", "https://lite.duckduckgo.com/lite/",
                   data={"q": query, "kl": "us-en"},
                   headers={"Referer": "https://lite.duckduckgo.com/"}, timeout=20)
        if r.status_code in (202, 429, 403):
            raise _Throttled()
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        out = []
        anchors = soup.select("a.result-link") or [
            a for a in soup.select("a[href^='http']") if "duckduckgo.com" not in a.get("href", "")
        ]
        for a in anchors:
            url = _decode_ddg_href(a.get("href", ""))
            if not url or "duckduckgo.com" in url:
                continue
            title = a.get_text(strip=True)
            if not title:
                continue
            out.append({"title": title, "url": url, "snippet": ""})
        return out
    except _Throttled:
        raise
    except Exception as exc:
        logger.warning("DDG-lite error: %s", exc)
        return []


def _yahoo(query: str, limit: int) -> List[Dict]:
    """Yahoo Search — very reliable under impersonation and returns deep, clean
    result URLs (often better than a single dork engine for `site:` queries)."""
    try:
        url = ("https://search.yahoo.com/search?p=" + urllib.parse.quote(query)
               + "&n=" + str(min(max(limit, 10), 20)))
        r = _fetch("get", url, timeout=20)
        if r.status_code in (429, 403, 503):
            raise _Throttled()
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        out, seen = [], set()
        for a in soup.select("h3.title a, div.algo a[href], ol.searchCenterMiddle a[href]"):
            href = a.get("href", "")
            if not href.startswith("http"):
                continue
            m = re.search(r"RU=([^/]+)/RK", href)  # unwrap Yahoo redirect
            real = urllib.parse.unquote(m.group(1)) if m else href
            if "yahoo.com" in real or real in seen:
                continue
            title = a.get_text(" ", strip=True)
            if not title:
                continue
            seen.add(real)
            out.append({"title": title, "url": real, "snippet": ""})
        return out
    except _Throttled:
        raise
    except Exception as exc:
        logger.warning("Yahoo error: %s", exc)
        return []


def _bing(query: str, limit: int) -> List[Dict]:
    try:
        url = ("https://www.bing.com/search?q=" + urllib.parse.quote(query)
               + "&count=" + str(min(max(limit, 10), 20)))
        r = _fetch("get", url, headers={"Referer": "https://www.bing.com/"}, timeout=20)
        if r.status_code in (429, 403):
            raise _Throttled()
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        out, seen = [], set()
        for li in soup.select("li.b_algo"):
            a = li.select_one("h2 a") or li.select_one("a[href^='http']")
            if not a:
                continue
            href = a.get("href", "")
            if not href.startswith("http") or "bing.com" in href or href in seen:
                continue
            snip = li.select_one("p") or li.select_one(".b_caption p")
            seen.add(href)
            out.append({"title": a.get_text(" ", strip=True), "url": href,
                        "snippet": snip.get_text(" ", strip=True) if snip else ""})
        return out
    except _Throttled:
        raise
    except Exception as exc:
        logger.warning("Bing error: %s", exc)
        return []


def _mojeek(query: str, limit: int) -> List[Dict]:
    try:
        r = _fetch("get", "https://www.mojeek.com/search?q=" + urllib.parse.quote(query), timeout=20)
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
    except Exception as exc:
        logger.warning("Mojeek error: %s", exc)
        return []


def _proxy_for_playwright(url: Optional[str]) -> Optional[dict]:
    """Shape a proxy URL into Playwright's launch(proxy=...) dict."""
    if not url:
        return None
    from urllib.parse import urlparse
    p = urlparse(url)
    out = {"server": f"{p.scheme}://{p.hostname}:{p.port}" if p.port else f"{p.scheme}://{p.hostname}"}
    if p.username:
        out["username"] = urllib.parse.unquote(p.username)
    if p.password:
        out["password"] = urllib.parse.unquote(p.password)
    return out


def _playwright_serp(query: str, limit: int) -> List[Dict]:
    """Near-unblockable last resort: render a real browser SERP when every HTTP
    engine is throttled. Expensive (~2-4s), so web_search only calls it when all
    else has failed. Uses the sync Playwright API (safe inside a worker thread).

    Lesson from crawl4ai/browser-use: a rendered browser defeats the fingerprint
    and JS challenges that block raw HTTP.
    """
    if os.getenv("SCRAPER_PLAYWRIGHT_FALLBACK", "1") != "1":
        return []
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return []
    try:
        from playwright_stealth import Stealth
        _stealth = Stealth()
    except Exception:
        _stealth = None

    from .proxy_pool import proxy_pool
    proxy = proxy_pool.get()
    out: List[Dict] = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                proxy=_proxy_for_playwright(proxy),
                args=["--disable-blink-features=AutomationControlled",
                      "--disable-features=IsolateOrigins,site-per-process"],
            )
            ctx = browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent=random.choice(USER_AGENTS),
                locale="en-US",
            )
            page = ctx.new_page()
            if _stealth:
                try:
                    _stealth.apply_stealth_sync(page)
                except Exception:
                    pass
            # Yahoo renders reliably in a headless browser (Bing/DDG hard-block it),
            # so it's primary; the others are best-effort behind it.
            engines = (
                ("https://search.yahoo.com/search?p=" + urllib.parse.quote(query),
                 "div#web a, ol.searchCenterMiddle a, h3 a", True),
                ("https://www.bing.com/search?q=" + urllib.parse.quote(query),
                 "li.b_algo h2 a", False),
                ("https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query),
                 "a.result__a", False),
            )
            for engine_url, sel, is_yahoo in engines:
                try:
                    page.goto(engine_url, timeout=22000, wait_until="domcontentloaded")
                    page.wait_for_timeout(2000)
                    for a in page.query_selector_all(sel):
                        href = a.get_attribute("href") or ""
                        title = (a.inner_text() or "").strip()
                        if is_yahoo:
                            m = re.search(r"RU=([^/]+)/RK", href)
                            if m:
                                href = urllib.parse.unquote(m.group(1))
                        href = _decode_ddg_href(href)
                        if (href.startswith("http") and title
                                and not any(e in href for e in ("bing.com", "yahoo.com", "duckduckgo.com"))):
                            out.append({"title": title, "url": href, "snippet": ""})
                    if out:
                        break
                except Exception as exc:
                    logger.debug("Playwright SERP on %s failed: %s", engine_url[:30], exc)
                    continue
            browser.close()
        proxy_pool.report(proxy, ok=bool(out))
        if out:
            logger.info("Playwright SERP fallback recovered %d results for %s", len(out), query)
        # de-dup
        seen, dd = set(), []
        for o in out:
            if o["url"] in seen:
                continue
            seen.add(o["url"])
            dd.append(o)
        return dd
    except Exception as exc:
        logger.warning("Playwright SERP fallback error: %s", exc)
        proxy_pool.report(proxy, ok=False)
        return []


# ── Registry ──────────────────────────────────────────────────────────────────
# (name, fn, is_keyed)
_KEYED_BACKENDS = [
    ("serper", _serper, True),
    ("brave", _brave, True),
    ("google_cse", _google_cse, True),
    ("searxng", _searxng, True),
]
_KEYLESS_BACKENDS = [
    ("ddg", _ddg, False),
    ("ddg_lite", _ddg_lite, False),
    ("yahoo", _yahoo, False),
    ("bing", _bing, False),
    ("mojeek", _mojeek, False),
]
_BACKENDS = _KEYED_BACKENDS + _KEYLESS_BACKENDS  # kept for external references


def _backend_env_present(name: str) -> bool:
    if name == "serper":
        from .serper_keys import key_manager
        return key_manager.has_active()
    return {
        "brave": bool(os.getenv("BRAVE_API_KEY")),
        "google_cse": bool(os.getenv("GOOGLE_CSE_KEY") and os.getenv("GOOGLE_CSE_CX")),
        "searxng": bool(os.getenv("SEARXNG_URL")),
    }.get(name, True)


def serper_configured() -> bool:
    """True if a usable Serper key exists — used to word the cooldown notice
    honestly (don't tell the user to add a key they already have)."""
    try:
        from .serper_keys import key_manager
        return key_manager.has_active()
    except Exception:
        return False


def configured_backends() -> List[str]:
    """Names of backends usable right now (configured + not cooling)."""
    names = []
    for name, _fn, _keyed in _BACKENDS:
        if _cooling(name):
            continue
        if name in ("serper", "brave", "google_cse", "searxng") and not _backend_env_present(name):
            continue
        names.append(name)
    return names


def _soonest_retry() -> int:
    now = time.time()
    return int(min((_backend_cooldown[n] - now for n in _backend_cooldown
                    if _backend_cooldown[n] > now), default=KEYLESS_COOLDOWN_S))


def web_search(query: str, limit: int = 10, search_mode: str = "auto",
               freshness: Optional[str] = None) -> List[Dict]:
    """
    Run `query` through the best available backend, failing over on throttle/block.

    `freshness` ('h'/'d'/'w'/'m'/'y' or None) asks backends for recent results
    only — Serper honours it exactly (Google's qdr: filter); Brave/CSE honour it
    to day-grain; keyless engines ignore it (the caller post-filters on the real
    result date). This is what surfaces hours-old buyer comments before anyone
    else replies.

    Returns List[{title, url, snippet, date?}].
      • Keyed backends are trusted: a 0-result answer is returned as-is.
      • Keyless engines are flaky, so they're tried in randomised order and an
        empty answer fails over to the next engine.
    Raises AllBackendsThrottled ONLY when every available backend is genuinely
    blocked (never for a query that simply had no matches).
    """
    tried: List[str] = []
    threw_throttle = False
    got_clean_empty = False  # an engine answered 200 with 0 matches (not a block)

    # 1) Keyed backends first (ban-proof), unless the caller forced keyless mode.
    if search_mode != "keyless":
        for name, fn, _keyed in _KEYED_BACKENDS:
            if not _backend_env_present(name):
                continue
            if _cooling(name):
                tried.append(f"{name}(cooling)")
                threw_throttle = True
                continue
            try:
                results = fn(query, limit, freshness)
                if results is None:  # not configured
                    continue
                tried.append(name)
                logger.info("Search via '%s': %d results for %s (freshness=%s)",
                            name, len(results), query, freshness or "any")
                return results  # keyed backends are trusted, even when empty
            except _Throttled:
                _cool_down(name, KEYED_COOLDOWN_S)
                tried.append(f"{name}(throttled)")
                threw_throttle = True
                continue

    # 2) Keyless pool — randomised rotation so no single engine is hammered.
    pool = [b for b in _KEYLESS_BACKENDS if not _cooling(b[0])]
    random.shuffle(pool)
    for i, (name, fn, _keyed) in enumerate(pool):
        if i > 0:
            time.sleep(random.uniform(0.4, 1.1))  # jittered pacing between engines
        try:
            results = fn(query, limit)
            if results:
                tried.append(name)
                logger.info("Search via '%s': %d results for %s", name, len(results), query)
                return results
            tried.append(f"{name}(empty)")
            got_clean_empty = True  # engine responded, just no matches → try next
        except _Throttled:
            _cool_down(name, KEYLESS_COOLDOWN_S)
            tried.append(f"{name}(throttled)")
            threw_throttle = True
            continue

    # keyless engines currently cooling still count toward "everything is blocked"
    for name, _fn, _keyed in _KEYLESS_BACKENDS:
        if _cooling(name) and f"{name}(throttled)" not in tried and name not in tried:
            tried.append(f"{name}(cooling)")
            threw_throttle = True

    # 3) Near-unblockable last resort: render a real browser SERP. Only worth its
    #    cost when every HTTP engine was blocked (not for a genuine 0-match query).
    if threw_throttle and not got_clean_empty:
        results = _playwright_serp(query, limit)
        if results:
            tried.append("playwright_serp")
            logger.info("Search via 'playwright_serp': %d results for %s", len(results), query)
            return results

    # 4) Outcome. Only cry "throttled" when nothing gave us any clean response.
    if threw_throttle and not got_clean_empty:
        raise AllBackendsThrottled(tried, max(_soonest_retry(), 1))
    return []
