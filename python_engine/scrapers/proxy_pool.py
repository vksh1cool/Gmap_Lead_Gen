"""
Rotating proxy pool with health tracking — the piece that makes scraping
"unlimited at scale" (crawlee's ProxyConfiguration + SessionPool lesson).

Zero-config by default: if no proxies are set the pool is empty and every caller
transparently falls back to a direct connection. Configure via env:

    SCRAPER_PROXIES="http://user:pass@host:port, http://host2:port2, socks5://host3:port3"
    # or newline-separated in a file:
    SCRAPER_PROXY_FILE="/path/to/proxies.txt"

Each proxy is round-robined; a proxy that fails repeatedly is benched for a
cooldown so we stop routing through a dead/blocked exit, then auto-revived.
"""
import os
import time
import random
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, List

logger = logging.getLogger(__name__)

_FAIL_THRESHOLD = 3          # consecutive fails before a proxy is benched
_BENCH_SECONDS = 5 * 60      # how long a benched proxy rests before a retry


def _normalise(raw: str) -> Optional[str]:
    raw = raw.strip().strip(",")
    if not raw or raw.startswith("#"):
        return None
    # Bare host:port → assume http. Keep any explicit scheme (http/https/socks5).
    if "://" not in raw:
        raw = "http://" + raw
    return raw


class ProxyPool:
    def __init__(self):
        self._lock = threading.Lock()
        self._proxies: List[Dict] = []
        self._idx = 0
        self._load()

    def _load(self) -> None:
        entries: List[str] = []
        env = os.getenv("SCRAPER_PROXIES", "")
        if env:
            entries += [p for chunk in env.split("\n") for p in chunk.split(",")]
        pfile = os.getenv("SCRAPER_PROXY_FILE", "")
        if pfile and Path(pfile).expanduser().exists():
            entries += Path(pfile).expanduser().read_text().splitlines()
        for e in entries:
            url = _normalise(e)
            if url:
                self._proxies.append({"url": url, "fails": 0, "benched_until": 0.0})
        if self._proxies:
            random.shuffle(self._proxies)
            logger.info("ProxyPool loaded %d proxies", len(self._proxies))

    @property
    def enabled(self) -> bool:
        return bool(self._proxies)

    def get(self) -> Optional[str]:
        """Next healthy proxy URL (round-robin), or None for a direct connection."""
        if not self._proxies:
            return None
        now = time.time()
        with self._lock:
            for _ in range(len(self._proxies)):
                p = self._proxies[self._idx % len(self._proxies)]
                self._idx += 1
                if p["benched_until"] <= now:
                    return p["url"]
            # every proxy benched → revive the one closest to ready (fail-open)
            soonest = min(self._proxies, key=lambda p: p["benched_until"])
            soonest["benched_until"] = 0.0
            soonest["fails"] = 0
            return soonest["url"]

    def report(self, url: Optional[str], ok: bool) -> None:
        if not url:
            return
        with self._lock:
            for p in self._proxies:
                if p["url"] != url:
                    continue
                if ok:
                    p["fails"] = 0
                    p["benched_until"] = 0.0
                else:
                    p["fails"] += 1
                    if p["fails"] >= _FAIL_THRESHOLD:
                        p["benched_until"] = time.time() + _BENCH_SECONDS
                        logger.warning("Proxy benched for %ds after %d fails: %s",
                                       _BENCH_SECONDS, p["fails"], url.split("@")[-1])
                return

    def as_requests_dict(self, url: Optional[str]) -> Optional[Dict[str, str]]:
        """Shape a proxy URL for requests/curl_cffi `proxies=` kwarg."""
        if not url:
            return None
        return {"http": url, "https": url}

    def status(self) -> List[Dict]:
        now = time.time()
        with self._lock:
            return [{"proxy": p["url"].split("@")[-1], "fails": p["fails"],
                     "healthy": p["benched_until"] <= now} for p in self._proxies]


# Singleton
proxy_pool = ProxyPool()
