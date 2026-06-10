"""
Per-platform rate limiter with circuit breaker and daily budget caps.
"""

import asyncio
import random
import time
import logging
from dataclasses import dataclass, field
from typing import Dict

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Platform defaults: (min_interval_ms, max_jitter_ms)
# ---------------------------------------------------------------------------
PLATFORM_DEFAULTS: Dict[str, tuple] = {
    "reddit":       (1800, 1400),
    "hackernews":   (1200, 800),
    "devto":        (1500, 1000),
    "stackoverflow":(1500, 1000),
    "twitter":      (2000, 1500),
    "linkedin":     (4000, 3000),
    "instagram":    (4000, 3000),
    "producthunt":  (2000, 1000),
    "quora":        (2000, 1000),
    "upwork":       (4000, 3000),
    "darkweb":      (3000, 2000),
}

# Tier budget caps per platform per day
API_DAILY_CAP = 200
BROWSER_DAILY_CAP = 25

API_TIER = {"reddit", "hackernews", "devto", "stackoverflow"}
BROWSER_TIER = {"twitter", "linkedin", "instagram", "producthunt", "quora", "upwork", "darkweb"}

# Circuit breaker constants
CB_BASE_BACKOFF_S = 3 * 3600       # 3 hours
CB_MAX_BACKOFF_S = 24 * 3600       # 24 hours


@dataclass
class _PlatformState:
    consecutive_failures: int = 0
    last_failure_ts: float = 0.0
    daily_count: int = 0
    daily_reset_ts: float = field(default_factory=time.time)

    def _maybe_reset_daily(self):
        now = time.time()
        if now - self.daily_reset_ts >= 86400:
            self.daily_count = 0
            self.daily_reset_ts = now


class RateLimiter:
    """Singleton-style rate limiter shared across all scrapers."""

    def __init__(self):
        self._states: Dict[str, _PlatformState] = {}

    def _get(self, platform: str) -> _PlatformState:
        if platform not in self._states:
            self._states[platform] = _PlatformState()
        return self._states[platform]

    # ── public API ────────────────────────────────────────────────────────

    async def wait(self, platform: str) -> None:
        """Sleep for the platform's min interval + random jitter."""
        min_ms, jitter_ms = PLATFORM_DEFAULTS.get(platform, (2000, 1000))
        delay_ms = min_ms + random.uniform(0, jitter_ms)
        await asyncio.sleep(delay_ms / 1000.0)

    def can_scrape(self, platform: str) -> bool:
        """Return True if the platform is not circuit-broken and under budget."""
        state = self._get(platform)
        state._maybe_reset_daily()

        # 1. Daily budget check
        cap = API_DAILY_CAP if platform in API_TIER else BROWSER_DAILY_CAP
        if state.daily_count >= cap:
            logger.warning("[%s] daily cap (%d) reached", platform, cap)
            return False

        # 2. Circuit breaker check
        if state.consecutive_failures == 0:
            return True

        backoff_s = min(
            CB_BASE_BACKOFF_S * (2 ** (state.consecutive_failures - 1)),
            CB_MAX_BACKOFF_S,
        )
        elapsed = time.time() - state.last_failure_ts
        if elapsed < backoff_s:
            logger.warning(
                "[%s] circuit open — %d consecutive failures, %.0fs remaining",
                platform,
                state.consecutive_failures,
                backoff_s - elapsed,
            )
            return False
        return True

    def report_block(self, platform: str) -> None:
        """Record a failure / block event."""
        state = self._get(platform)
        state.consecutive_failures += 1
        state.last_failure_ts = time.time()
        logger.warning(
            "[%s] block reported — consecutive failures now %d",
            platform,
            state.consecutive_failures,
        )

    def report_success(self, platform: str) -> None:
        """Reset the circuit breaker on success."""
        state = self._get(platform)
        state.consecutive_failures = 0
        state.daily_count += 1

    def increment_daily(self, platform: str) -> None:
        """Bump daily counter without resetting failures (for partial successes)."""
        state = self._get(platform)
        state._maybe_reset_daily()
        state.daily_count += 1


# Module-level singleton
rate_limiter = RateLimiter()
