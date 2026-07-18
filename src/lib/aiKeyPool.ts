/**
 * AI key pool — many keys across providers, rotated with failover.
 *
 * Mirrors the Serper key-pool idea but for LLM providers, and lives in Node
 * (scoring/intent run in the Next layer). You can add as many Groq + NIM (+
 * OpenAI/Gemini) keys as you like via the Settings UI; the pool round-robins
 * across every healthy key and fails over on quota/auth errors — so Groq and
 * NIM genuinely work *together*.
 *
 * Source of truth: a gitignored JSON file (ai_keys.json) so runtime-added keys
 * survive restarts. Seeded once from env (groq_api_key / GROQ_API_KEYS /
 * nim_key / NIM_API_KEYS / OPENAI_API_KEY / GEMINI_API_KEY).
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { cacheKey, cacheGet, cacheSet } from './aiCache';

export type AiProvider = 'groq' | 'nim' | 'openai' | 'gemini';

export const PROVIDERS: AiProvider[] = ['groq', 'nim', 'openai', 'gemini'];

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  groq: 'llama-3.3-70b-versatile',
  nim: 'meta/llama-3.3-70b-instruct',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
};

export function baseUrlFor(provider: AiProvider): string | undefined {
  if (provider === 'nim') return 'https://integrate.api.nvidia.com/v1';
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai/';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  return undefined; // openai default
}

interface AiKeyEntry {
  id: string;
  provider: AiProvider;
  key: string;
  model?: string;
  source: 'env' | 'manual';
  added_at: string;
  exhausted: boolean;        // hard-disabled (bad key / quota drained)
  cooldown_until?: number;   // transient (rate-limited); epoch ms
  reason?: string;
  last_ok?: string;
}

const STORE = path.join(process.cwd(), 'ai_keys.json');

function nowIso() { return new Date().toISOString(); }

function mask(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return key.slice(0, 3) + '…';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function idFor(provider: string, key: string): string {
  return `${provider}_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

// Persist the singleton across Next.js dev HMR reloads.
interface PoolState { keys: AiKeyEntry[]; rr: number; seeded: boolean }
const g = globalThis as any;

function state(): PoolState {
  if (!g.__aiKeyPool) {
    g.__aiKeyPool = { keys: [], rr: 0, seeded: false } as PoolState;
    load();
    seedFromEnv();
  }
  return g.__aiKeyPool as PoolState;
}

function load() {
  try {
    if (fs.existsSync(STORE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      g.__aiKeyPool.keys = Array.isArray(parsed.keys) ? parsed.keys : [];
    }
  } catch { g.__aiKeyPool.keys = []; }
}

function save() {
  try {
    const tmp = STORE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ keys: g.__aiKeyPool.keys }, null, 2));
    fs.renameSync(tmp, STORE);
  } catch { /* best-effort */ }
}

function envList(...names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) {
      for (const part of v.split(',')) {
        const k = part.trim();
        if (k) out.push(k);
      }
    }
  }
  return out;
}

function seedFromEnv() {
  const st = g.__aiKeyPool as PoolState;
  if (st.seeded) return;
  const seeds: Array<{ provider: AiProvider; key: string }> = [];
  envList('groq_api_key', 'GROQ_API_KEY', 'GROQ_API_KEYS').forEach(k => seeds.push({ provider: 'groq', key: k }));
  envList('nim_key', 'NIM_KEY', 'nim_api_key', 'NIM_API_KEY', 'NIM_API_KEYS', 'NVIDIA_API_KEY').forEach(k => seeds.push({ provider: 'nim', key: k }));
  envList('OPENAI_API_KEY', 'openai_api_key').forEach(k => seeds.push({ provider: 'openai', key: k }));
  envList('GEMINI_API_KEY', 'gemini_api_key', 'GOOGLE_API_KEY').forEach(k => seeds.push({ provider: 'gemini', key: k }));

  const existing = new Set(st.keys.map(k => k.id));
  let changed = false;
  for (const s of seeds) {
    const id = idFor(s.provider, s.key);
    if (!existing.has(id)) {
      st.keys.push({ id, provider: s.provider, key: s.key, source: 'env', added_at: nowIso(), exhausted: false });
      existing.add(id);
      changed = true;
    }
  }
  st.seeded = true;
  if (changed) save();
}

function isAvailable(e: AiKeyEntry): boolean {
  if (e.exhausted) return false;
  if (e.cooldown_until && e.cooldown_until > Date.now()) return false;
  return true;
}

// ── Public: status / management ──────────────────────────────────────────────

export function listStatus() {
  const st = state();
  const keys = st.keys.map((k, i) => ({
    id: k.id,
    provider: k.provider,
    masked: mask(k.key),
    model: k.model || DEFAULT_MODELS[k.provider],
    source: k.source,
    exhausted: !!k.exhausted,
    cooling: !!(k.cooldown_until && k.cooldown_until > Date.now()),
    available: isAvailable(k),
    reason: k.reason || '',
    added_at: k.added_at,
    last_ok: k.last_ok,
  }));
  const byProvider: Record<string, { total: number; available: number }> = {};
  for (const k of keys) {
    byProvider[k.provider] = byProvider[k.provider] || { total: 0, available: 0 };
    byProvider[k.provider].total++;
    if (k.available) byProvider[k.provider].available++;
  }
  return {
    keys,
    total: keys.length,
    available: keys.filter(k => k.available).length,
    byProvider,
  };
}

export function addKey(provider: AiProvider, key: string, model?: string): { ok: boolean; id?: string } {
  key = (key || '').trim();
  if (!key || !PROVIDERS.includes(provider)) return { ok: false };
  const st = state();
  const id = idFor(provider, key);
  const existing = st.keys.find(k => k.id === id);
  if (existing) {
    // Re-activate + update model.
    existing.exhausted = false;
    delete existing.cooldown_until;
    delete existing.reason;
    if (model) existing.model = model;
    save();
    return { ok: true, id };
  }
  st.keys.push({ id, provider, key, model, source: 'manual', added_at: nowIso(), exhausted: false });
  save();
  return { ok: true, id };
}

export function removeKey(id: string): boolean {
  const st = state();
  const before = st.keys.length;
  st.keys = st.keys.filter(k => k.id !== id);
  if (st.keys.length !== before) { save(); return true; }
  return false;
}

export function resetAll() {
  const st = state();
  for (const k of st.keys) { k.exhausted = false; delete k.cooldown_until; delete k.reason; }
  save();
}

export function hasAnyKey(): boolean {
  return state().keys.some(isAvailable);
}

function markExhausted(id: string, reason: string) {
  const st = state();
  const e = st.keys.find(k => k.id === id);
  if (e) { e.exhausted = true; e.reason = reason; save(); }
}

function markCooldown(id: string, ms: number, reason: string) {
  const st = state();
  const e = st.keys.find(k => k.id === id);
  if (e) { e.cooldown_until = Date.now() + ms; e.reason = reason; save(); }
}

function markOk(id: string) {
  const st = state();
  const e = st.keys.find(k => k.id === id);
  if (e) { e.last_ok = nowIso(); if (e.cooldown_until) delete e.cooldown_until; }
}

// Classify a provider error → how to treat the key.
function classifyError(err: any): 'auth' | 'rate' | 'quota' | 'other' {
  const status = err?.status || err?.statusCode || err?.response?.status;
  const msg = (err?.message || '').toLowerCase();
  if (status === 401 || status === 403 || msg.includes('invalid api key') || msg.includes('unauthorized')) return 'auth';
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) return 'rate';
  if (msg.includes('quota') || msg.includes('insufficient') || msg.includes('exceeded') || msg.includes('credit')) return 'quota';
  return 'other';
}

// ── Public: the rotating chat call ───────────────────────────────────────────

export interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  // Preferred provider/model hint from the UI (try this provider first).
  preferProvider?: string;
  preferModel?: string;
  // Optional explicit client key (advanced override) tried before the pool.
  clientKey?: string;
  clientProvider?: AiProvider;
  clientModel?: string;
  // Skip the response cache (force a fresh call).
  noCache?: boolean;
}

interface Candidate { id: string | null; provider: AiProvider; key: string; model: string }

function buildCandidates(opts: ChatOpts): Candidate[] {
  const st = state();
  const list: Candidate[] = [];

  // 1) Explicit client key first (highest priority, not persisted).
  if (opts.clientKey && opts.clientKey.trim()) {
    const provider = (opts.clientProvider || (opts.preferProvider as AiProvider) || 'groq') as AiProvider;
    list.push({ id: null, provider, key: opts.clientKey.trim(), model: opts.clientModel || DEFAULT_MODELS[provider] });
  }

  // 2) Available pool entries, round-robin, preferred provider first.
  const avail = st.keys.filter(isAvailable);
  if (avail.length) {
    const start = st.rr % avail.length;
    const rotated = [...avail.slice(start), ...avail.slice(0, start)];
    st.rr = (st.rr + 1) % Math.max(avail.length, 1);
    const prefer = opts.preferProvider;
    rotated.sort((a, b) => {
      const ap = a.provider === prefer ? 0 : 1;
      const bp = b.provider === prefer ? 0 : 1;
      return ap - bp;
    });
    for (const e of rotated) {
      const model = (e.provider === prefer && opts.preferModel) ? opts.preferModel : (e.model || DEFAULT_MODELS[e.provider]);
      list.push({ id: e.id, provider: e.provider, key: e.key, model });
    }
  }
  return list;
}

/**
 * Run a chat completion against the pool with failover. Returns the message
 * text, or null if there are no keys / every key failed (caller then falls
 * back to its rule-based path). Never throws for provider errors.
 */
export async function chatComplete(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: ChatOpts = {},
): Promise<{ text: string; provider: AiProvider; model: string } | null> {
  // Short-term memory: identical prompt → reuse the answer, no credit spent.
  const ck = opts.noCache ? null : cacheKey(messages, opts.maxTokens);
  if (ck) {
    const hit = cacheGet(ck);
    if (hit !== null) return { text: hit, provider: 'groq' as AiProvider, model: 'cache' };
  }

  const candidates = buildCandidates(opts);
  if (!candidates.length) return null;

  let lastErr: any = null;
  for (const c of candidates) {
    try {
      const clientOpts: any = { apiKey: c.key, maxRetries: 0, timeout: 30000 };
      const baseURL = baseUrlFor(c.provider);
      if (baseURL) clientOpts.baseURL = baseURL;
      const client = new OpenAI(clientOpts);

      const resp = await client.chat.completions.create({
        model: c.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 300,
      });
      const text = resp.choices[0]?.message?.content?.trim() || '';
      if (c.id) markOk(c.id);
      if (ck && text) cacheSet(ck, text);
      return { text, provider: c.provider, model: c.model };
    } catch (err: any) {
      lastErr = err;
      const kind = classifyError(err);
      if (c.id) {
        if (kind === 'auth' || kind === 'quota') markExhausted(c.id, `${kind}: ${(err?.message || '').slice(0, 120)}`);
        else if (kind === 'rate') markCooldown(c.id, 60_000, 'rate-limited');
        // 'other' (timeout/5xx) → just try the next key, don't disable this one.
      }
      // continue to next candidate
    }
  }
  if (lastErr) console.error('[aiKeyPool] all candidates failed:', lastErr?.message);
  return null;
}

/**
 * Live-validate a single key with a 1-token ping. A rate-limit counts as valid
 * (the key works, it's just busy). Auth/quota errors count as invalid.
 */
export async function validateKey(
  provider: AiProvider,
  key: string,
  model?: string,
): Promise<{ ok: boolean; reason?: string }> {
  key = (key || '').trim();
  if (!key) return { ok: false, reason: 'empty key' };
  if (!PROVIDERS.includes(provider)) return { ok: false, reason: 'unknown provider' };
  try {
    const clientOpts: any = { apiKey: key, maxRetries: 0, timeout: 15000 };
    const baseURL = baseUrlFor(provider);
    if (baseURL) clientOpts.baseURL = baseURL;
    const client = new OpenAI(clientOpts);
    await client.chat.completions.create({
      model: model || DEFAULT_MODELS[provider],
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0,
    });
    return { ok: true };
  } catch (err: any) {
    const kind = classifyError(err);
    if (kind === 'rate') return { ok: true, reason: 'valid (rate-limited right now)' };
    return { ok: false, reason: `${kind}: ${(err?.message || 'request failed').slice(0, 140)}` };
  }
}
