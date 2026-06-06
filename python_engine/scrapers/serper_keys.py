"""
Serper.dev API-key pool with automatic rotation.

Serper's free tier is 2,500 credits (1 credit/search) per account. To keep the
tool running past that, you create another free account and add its key — this
manager holds a pool of keys, hands out the first non-exhausted one, and when a
key 403s ("Not enough credits") it's marked exhausted and the next key takes over.

Source of truth is a gitignored JSON file (python_engine/serper_keys.json) so
keys added at runtime (via the Settings UI) survive restarts. The pool is seeded
once from SERPER_API_KEYS (comma-separated) / SERPER_API_KEY in the env.
"""

import os
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Optional

STORE = Path(__file__).resolve().parent.parent / "serper_keys.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask(key: str) -> str:
    if len(key) <= 12:
        return key[:3] + "…"
    return f"{key[:6]}…{key[-4:]}"


class SerperKeyManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._keys: List[Dict] = []
        self._load()
        self._seed_from_env()

    # ── persistence ──
    def _load(self) -> None:
        if STORE.exists():
            try:
                self._keys = json.loads(STORE.read_text()).get("keys", [])
            except (ValueError, OSError):
                self._keys = []

    def _save(self) -> None:
        try:
            STORE.write_text(json.dumps({"keys": self._keys}, indent=2))
        except OSError:
            pass

    def _seed_from_env(self) -> None:
        env_keys: List[str] = []
        if os.getenv("SERPER_API_KEYS"):
            env_keys += [k.strip() for k in os.getenv("SERPER_API_KEYS").split(",") if k.strip()]
        if os.getenv("SERPER_API_KEY"):
            env_keys.append(os.getenv("SERPER_API_KEY").strip())
        existing = {k["key"] for k in self._keys}
        changed = False
        for k in env_keys:
            if k and k not in existing:
                self._keys.append({"key": k, "exhausted": False, "added_at": _now(), "source": "env"})
                existing.add(k)
                changed = True
        if changed:
            self._save()

    # ── public API ──
    def active_key(self) -> Optional[str]:
        """First non-exhausted key, or None if the pool is empty/all exhausted."""
        with self._lock:
            for k in self._keys:
                if not k.get("exhausted"):
                    return k["key"]
        return None

    def has_active(self) -> bool:
        return self.active_key() is not None

    def mark_exhausted(self, key: str, reason: str = "") -> None:
        with self._lock:
            for k in self._keys:
                if k["key"] == key:
                    k["exhausted"] = True
                    k["exhausted_at"] = _now()
                    k["reason"] = reason
            self._save()

    def add_key(self, key: str) -> bool:
        key = (key or "").strip()
        if not key:
            return False
        with self._lock:
            for k in self._keys:
                if k["key"] == key:
                    # Re-activate an existing (perhaps previously exhausted) key.
                    k["exhausted"] = False
                    k.pop("exhausted_at", None)
                    self._save()
                    return True
            self._keys.append({"key": key, "exhausted": False, "added_at": _now(), "source": "manual"})
            self._save()
            return True

    def remove_key_by_tail(self, tail: str) -> bool:
        with self._lock:
            before = len(self._keys)
            self._keys = [k for k in self._keys if not k["key"].endswith(tail)]
            if len(self._keys) != before:
                self._save()
                return True
        return False

    def reset_all(self) -> None:
        """Un-exhaust every key (e.g. after a monthly reset on paid plans)."""
        with self._lock:
            for k in self._keys:
                k["exhausted"] = False
                k.pop("exhausted_at", None)
            self._save()

    def list_status(self) -> List[Dict]:
        with self._lock:
            active_seen = False
            out = []
            for k in self._keys:
                is_active = (not k.get("exhausted")) and not active_seen
                if is_active:
                    active_seen = True
                out.append({
                    "masked": _mask(k["key"]),
                    "tail": k["key"][-6:],
                    "exhausted": bool(k.get("exhausted")),
                    "active": is_active,
                    "source": k.get("source", ""),
                    "added_at": k.get("added_at"),
                })
            return out


# Module-level singleton
key_manager = SerperKeyManager()
