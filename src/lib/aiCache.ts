/**
 * AI response cache — the tool's short-term memory.
 *
 * LLM calls for the same prompt (e.g. re-scraping a lead you already scored, or
 * re-running the same intent) are deterministic enough that we can reuse the
 * answer instead of spending another API credit. Keyed by a hash of the exact
 * messages + token budget. Persisted to a gitignored JSON so the memory
 * survives restarts. LRU-capped with a TTL so it can't grow unbounded or go stale.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STORE = path.join(process.cwd(), 'ai_cache.json');
const MAX_ENTRIES = 5000;
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const FLUSH_EVERY = 10;                   // dirty writes before a flush
const FLUSH_DEBOUNCE_MS = 4000;

interface Entry { text: string; ts: number }
interface CacheState {
  map: Map<string, Entry>;
  order: string[];      // LRU: oldest first
  hits: number;
  misses: number;
  dirty: number;
  lastFlush: number;
  flushTimer: any;
  loaded: boolean;
}

const g = globalThis as any;

function state(): CacheState {
  if (!g.__aiCache) {
    g.__aiCache = { map: new Map(), order: [], hits: 0, misses: 0, dirty: 0, lastFlush: 0, flushTimer: null, loaded: false } as CacheState;
    load();
  }
  return g.__aiCache as CacheState;
}

function load() {
  const st = g.__aiCache as CacheState;
  try {
    if (fs.existsSync(STORE)) {
      const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      const now = Date.now();
      for (const [k, v] of Object.entries(raw.entries || {})) {
        const e = v as Entry;
        if (e && typeof e.text === 'string' && now - e.ts < TTL_MS) {
          st.map.set(k, e);
          st.order.push(k);
        }
      }
    }
  } catch { /* start empty */ }
  st.loaded = true;
}

function flush() {
  const st = g.__aiCache as CacheState;
  try {
    const entries: Record<string, Entry> = {};
    for (const [k, v] of st.map) entries[k] = v;
    const tmp = STORE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ entries }));
    fs.renameSync(tmp, STORE);
    st.dirty = 0;
    st.lastFlush = Date.now();
  } catch { /* best-effort */ }
}

function scheduleFlush() {
  const st = g.__aiCache as CacheState;
  st.dirty++;
  if (st.dirty >= FLUSH_EVERY) { flush(); return; }
  if (st.flushTimer) return;
  st.flushTimer = setTimeout(() => { st.flushTimer = null; if (st.dirty > 0) flush(); }, FLUSH_DEBOUNCE_MS);
  // Don't keep the process alive just for a cache flush.
  if (st.flushTimer?.unref) st.flushTimer.unref();
}

export function cacheKey(messages: any[], maxTokens?: number): string {
  const basis = JSON.stringify(messages) + '|' + (maxTokens ?? '');
  return crypto.createHash('sha1').update(basis).digest('hex');
}

export function cacheGet(key: string): string | null {
  const st = state();
  const e = st.map.get(key);
  if (!e) { st.misses++; return null; }
  if (Date.now() - e.ts >= TTL_MS) {
    st.map.delete(key);
    const i = st.order.indexOf(key);
    if (i >= 0) st.order.splice(i, 1);
    st.misses++;
    return null;
  }
  // LRU touch.
  const i = st.order.indexOf(key);
  if (i >= 0) st.order.splice(i, 1);
  st.order.push(key);
  st.hits++;
  return e.text;
}

export function cacheSet(key: string, text: string) {
  if (!text) return;
  const st = state();
  if (!st.map.has(key)) st.order.push(key);
  st.map.set(key, { text, ts: Date.now() });
  // Evict oldest beyond the cap.
  while (st.order.length > MAX_ENTRIES) {
    const oldest = st.order.shift();
    if (oldest) st.map.delete(oldest);
  }
  scheduleFlush();
}

export function cacheStats() {
  const st = state();
  const total = st.hits + st.misses;
  return {
    entries: st.map.size,
    hits: st.hits,
    misses: st.misses,
    hitRate: total ? Math.round((st.hits / total) * 100) : 0,
  };
}

export function cacheClear() {
  const st = state();
  st.map.clear();
  st.order = [];
  st.hits = 0;
  st.misses = 0;
  flush();
}
