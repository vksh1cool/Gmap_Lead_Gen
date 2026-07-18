# Scraper Status & Setup

Smart multi-platform lead scraper. Last verified: 2026-06-06.

## TL;DR — to get all platforms working reliably without banning your IP

1. `cp python_engine/.env.example python_engine/.env`
2. Add one or more **free Serper.dev keys** (`SERPER_API_KEYS=key1,key2,…`) — 2,500 free
   queries each, no credit card (https://serper.dev). This makes LinkedIn / Instagram /
   Quora / Upwork / Reddit / ProductHunt reliable and **ban-proof** (it's an API).
3. Optional: add `REDDIT_CLIENT_ID`/`SECRET` and `PRODUCTHUNT_TOKEN` (both free) for the
   richest native data on those two.
4. Restart the engine. Done.

### Serper key rotation (never run dry)

Each free Serper account = 2,500 searches (1 credit/search). The engine holds a **pool**
of keys and auto-rotates: when a key 403s ("Not enough credits") it's marked exhausted
and the next key takes over — mid-run, no restart. **Add keys live** in the app at
**/settings → Serper Search Keys**: create another free Serper account, paste its key,
and the pool grows. Keys persist in `python_engine/serper_keys.json` (gitignored).

Without keys, the tool still runs (keyless DuckDuckGo/Mojeek fallback) but will hit
rate-limits on a single IP — when it does, a **dialog pops up**, that platform pauses
for a cooldown, and the others keep going. Nothing gets your IP banned.

## Why keys matter (the IP reality)

Running on localhost does **not** give you rotating IPs — your machine has one fixed
public IP from your ISP. Hammering search engines from it gets that IP rate-limited
(DuckDuckGo 202, Bing region-gate, Mojeek 403). Keyed APIs (Serper) and native APIs
(Reddit, ProductHunt) are built for programmatic access and never ban you.

## Platform reliability tiers

| Platform        | With recommended keys | Keyless fallback | Path |
|-----------------|----------------------|------------------|------|
| **Google Maps** | ✅ Reliable | ✅ Reliable | Playwright + stealth (no search engine needed) |
| **Website (HTTrack)** | ✅ Reliable | ✅ Reliable | HTTrack site mirror → email/phone/social harvest (needs `httrack` binary) |
| **HackerNews**  | ✅ Reliable | ✅ Reliable | Algolia API |
| **StackOverflow** | ✅ Reliable | ✅ Reliable | Official API |
| **Dev.to**      | ✅ Reliable | ✅ Reliable | Official Forem API |
| **Reddit**      | ✅ Reliable (OAuth) | ⚠️ Dork (rate-limit-prone) | `REDDIT_CLIENT_ID` → OAuth; else Serper/keyless dork |
| **ProductHunt** | ✅ Reliable (API) | ⚠️ Dork | `PRODUCTHUNT_TOKEN` → GraphQL; else dork |
| **LinkedIn**    | ✅ Reliable (Serper) | ⚠️ Best-effort | `site:` dork via search backend |
| **Instagram**   | ✅ Reliable (Serper) | ⚠️ Best-effort | dork |
| **Quora**       | ✅ Reliable (Serper) | ⚠️ Best-effort | dork |
| **Upwork**      | ✅ Reliable (Serper) | ⚠️ Best-effort | dork |
| **IndiaMART**   | ✅ Reliable (Serper) | ⚠️ Best-effort | `site:indiamart.com` dork (listing name + URL) |
| **Justdial**    | ✅ Reliable (Serper) | ⚠️ Best-effort | `site:justdial.com` dork (listing name + URL) |
| **X / Twitter** | ⚠️ Nitter mirrors | ⚠️ Nitter mirrors | No free API exists; mirror fallback (set `NITTER_INSTANCES`) |

## Search backend chain (for the dork platforms)

`web_search()` tries backends in order, failing over on throttle:
**Serper → Brave → Google CSE → SearXNG → DuckDuckGo → Mojeek**.
Keyed backends (top of the list) are ban-proof; keyless ones are paced, UA-rotated, and
circuit-broken. If *every* available backend is throttled, it raises a rate-limit notice
→ the UI dialog → that platform pauses for a cooldown (escalating: ~15 min keyless).

## Running it

```bash
# 1. Python scraping engine (port 8000)
cd python_engine
./venv/bin/pip install -r requirements.txt        # first time
./venv/bin/python -m playwright install chromium  # first time (Maps + X)
cp .env.example .env && $EDITOR .env              # add your keys
./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000

# 2. Next.js app (port 3000) — second terminal, repo root
npm run dev
```

Open http://localhost:3000/scraper → pick platforms → niche+location (Maps) and/or a
keyword (social) → run. Leads stream in, get AI-scored, land in the CRM at `/crm`,
export to CSV. If a platform rate-limits, the cooldown dialog appears; just continue.

## AI scoring

Works **without any API key** via a rule-based engine (buyer-intent phrases,
claimed-status, rating/review gaps, seller/competitor detection). Add a provider key in
Settings (NVIDIA NIM / OpenAI / Gemini) to upgrade to LLM scoring with personalized
pitches. Rule engine is always the fallback, so scoring never hard-fails.

## All env vars (`python_engine/.env`)

| Var | What it unlocks | Free? |
|-----|-----------------|-------|
| `SERPER_API_KEY` | Reliable LinkedIn/Instagram/Quora/Upwork (+ Reddit/PH dork fallback) | 2,500 free, no card |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Rich native Reddit data | Free |
| `PRODUCTHUNT_TOKEN` | Native ProductHunt leads | Free |
| `BRAVE_API_KEY` / `GOOGLE_CSE_KEY`+`GOOGLE_CSE_CX` / `SEARXNG_URL` | Alternate search backends | varies |
| `NITTER_INSTANCES` | Working X/Twitter mirrors | Free |

All optional; the engine degrades gracefully and never bans your IP.
