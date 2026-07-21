"""
Per-domain adaptive throttle (scrapy's AutoThrottle lesson).

Self-paces requests per target host so a single IP never bursts a site into a
ban. Each domain keeps its own delay that eases toward a fast target on success
and backs off exponentially on a block signal (429/403), then recovers.

Thread-safe: the scrapers run request work in threads via asyncio.to_thread.
"""
import time
import random
import logging
import threading
from urllib.parse import urlparse
from typing import Dict

logger = logging.getLogger(__name__)

# Tunables (seconds).
_TARGET_DELAY = 1.0     # steady-state spacing we aim for per domain
_MIN_DELAY = 0.4        # never go below this
_MAX_DELAY = 30.0       # ceiling when a domain is angry
_BACKOFF = 2.0          # multiply delay by this on a block
_RECOVER = 0.85         # multiply delay by this on a clean success


class _DomainState:
    __slots__ = ("delay", "last_ts")

    def __init__(self):
        self.delay = _TARGET_DELAY
        self.last_ts = 0.0


class AutoThrottle:
    def __init__(self):
        self._lock = threading.Lock()
        self._domains: Dict[str, _DomainState] = {}

    @staticmethod
    def _host(url: str) -> str:
        try:
            return urlparse(url).netloc.lower() or "unknown"
        except Exception:
            return "unknown"

    def wait(self, url: str) -> None:
        """Block until it's polite to hit this URL's domain, then reserve the slot."""
        host = self._host(url)
        with self._lock:
            st = self._domains.setdefault(host, _DomainState())
            now = time.time()
            earliest = st.last_ts + st.delay + random.uniform(0, st.delay * 0.4)
            sleep_for = max(0.0, earliest - now)
            # Reserve immediately so concurrent threads queue instead of colliding.
            st.last_ts = max(now, earliest)
        if sleep_for > 0:
            time.sleep(sleep_for)

    def report(self, url: str, blocked: bool) -> None:
        host = self._host(url)
        with self._lock:
            st = self._domains.setdefault(host, _DomainState())
            if blocked:
                st.delay = min(_MAX_DELAY, st.delay * _BACKOFF)
                logger.debug("AutoThrottle backoff %s → %.1fs", host, st.delay)
            else:
                st.delay = max(_MIN_DELAY, st.delay * _RECOVER)

    def status(self) -> Dict[str, float]:
        with self._lock:
            return {h: round(s.delay, 2) for h, s in self._domains.items()}


# Singleton
autothrottle = AutoThrottle()
