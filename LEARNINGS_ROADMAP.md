# Lead Engine — Learnings & Integration Roadmap

What we can borrow from each reference tool in `../Lead_Scraping_tools_learn/`, mapped
to concrete changes in **this** codebase. Ordered by value-for-effort.

Legend: ✅ applied · 🔜 next · 🧭 later / bigger lift

---

## Already applied

- **AI works from `.env.local`** — `src/lib/aiConfig.ts` resolves an AI key from the
  request or falls back to server env (`groq_api_key` → `nim_key` → OpenAI → Gemini).
  **Groq** added as a first-class provider (`api.groq.com`, `llama-3.3-70b-versatile`).
  A fresh clone with keys in `.env.local` gets working scoring + intent with zero UI setup.
- **Platform set completed** — Facebook added; IndiaMART + Justdial added earlier. Named
  set (gmaps, reddit, x, linkedin, facebook, instagram, quora + more) all return leads.
- **LinkedIn decision-maker targeting** (from OpenOutreach's ICP idea) — LinkedIn dorks
  now include a founder/CEO/owner/director variant to surface the actual buyer.
- **HTTrack website mirroring** — `python_engine/scrapers/website_mirror.py` +
  `/scrape-website` endpoint + `website` platform in the UI. Mirrors a whole site
  (bounded depth/size/time) and harvests emails, phones, and social profiles.
- ✅ **Robust contact extraction** (patterns learned from firecrawl / google-maps-scraper
  enrichment): email de-obfuscation (`name [at] domain [dot] com` → `name@domain.com`),
  a junk-email blocklist (sentry, wixpress, asset filenames, placeholders), phone
  validation by digit count, and social-URL harvesting. Lives in `website_mirror.py`
  and should be **hoisted into a shared `scrapers/extract.py`** so the Google Maps
  `crawl_website()` in `main.py` uses the same high-quality filters (🔜 quick win).

---

## Per-tool roadmap

### 1. curl-impersonate 🔜 (highest value / lowest effort)
**What it is:** a curl build that forges real-browser TLS/JA3 + HTTP2 fingerprints, so
requests look like Chrome/Firefox at the network layer — defeats Cloudflare/Akamai
fingerprint blocks that plain `requests`/`httpx` trip.
**Apply here:** the keyless search backends (`scrapers/search_backends.py`) and the
website crawler currently get rate-limited/blocked on a single IP. Swap the raw HTTP
calls for `curl_cffi` (the Python binding, `pip install curl_cffi`) with
`impersonate="chrome124"`. Biggest reliability jump for the least code.

### 2. Scrapling 🔜
**What it is:** adaptive Python scraping — stealth fetchers + selectors that survive DOM
changes ("find this element again even if the site redesigned").
**Apply here:** replace brittle Playwright selectors in `main.py` `process_business_url()`
(the `aria-label*="stars"` / `data-item-id` locators break when Google tweaks markup)
with Scrapling's adaptive matching, and use its `StealthyFetcher` for the website crawl
path as a lighter alternative to full Playwright.

### 3. google-maps-scraper (omkarcloud, Botasaurus) 🧭
**What it is:** the most-starred Maps scraper; Botasaurus-based, high results-per-city,
**working review extraction**, and built-in email/social enrichment.
**Apply here:** our Maps scraper stops at the listing + one homepage crawl. Port two
ideas: (a) their **pagination/scroll strategy** for far more results per query, and
(b) **review extraction** (pull recent reviews → feed the AI scorer richer intent
signals). Keep our Playwright engine; borrow the extraction recipes.

### 4. firecrawl 🧭
**What it is:** turns sites into LLM-ready markdown; `/scrape`, `/crawl`, `/map`,
`/extract` endpoints.
**Apply here:** add a `/map` style **site-structure discovery** before HTTrack mirroring
(find contact/about/team pages first, mirror those preferentially = faster, higher hit
rate). Longer term, a firecrawl-style `/extract` with a schema would let the AI pull
structured fields (company size, decision-makers) from the mirrored HTML.

### 5. crawl4ai 🧭
**What it is:** async LLM-friendly crawler, clean markdown output, good for RAG.
**Apply here:** feed the AI scorer better input. Instead of our crude "longest text
block" heuristic in `scrapers/enrichment.py`, use crawl4ai's markdown extraction so the
LLM sees clean page content → better rationales and pitches.

### 6. autoscraper 🧭
**What it is:** learn-by-example — give it a URL + a sample of the data you want, it
infers the extraction rules.
**Apply here:** a "teach a source" feature — user pastes a directory/listing URL and one
example lead, autoscraper generalizes it into a reusable scraper for that site. Turns the
tool from fixed-platform into **any-site**.

### 7. crawlee 🧭
**What it is:** Apify's crawling framework — request queue, **session pool**, proxy
rotation, fingerprint injection, auto-retry.
**Apply here:** the architectural backbone if we outgrow the current ad-hoc loops. Its
session-pool + proxy-rotation model is the clean answer to the "one IP gets banned"
problem the SCRAPER_STATUS.md calls out. Adopt if we move to proxied scraping at scale.

### 8. scrapy 🧭
**What it is:** the mature Python scraping framework — spiders, item pipelines,
AutoThrottle, dupe filtering.
**Apply here:** reference for a **pipeline architecture** — normalize → dedupe → enrich →
score → persist as discrete stages (we currently inline all of this in the Next.js
route). AutoThrottle is a proven model for our `AntiBanEngine` backoff.

### 9. browser-use 🧭 (biggest lift)
**What it is:** agentic browser automation driven by an LLM (Playwright + LLM loop).
**Apply here:** the endgame for gated sources (LinkedIn/Instagram) — an agent that logs
in and navigates like a human instead of relying on `site:` dorks. High capability, high
maintenance/ToS risk; gate behind an explicit opt-in.

### 10. OpenOutreach (the unzipped folder) 🧭 — the *other half* of the funnel
**What it is:** self-hosted B2B outreach — describe product + ICP, it discovers leads on
LinkedIn, qualifies them with a **Bayesian GP model over profile embeddings**
(explore/exploit), resolves work emails, and runs **email-first + LinkedIn-fallback**
agentic sequences. See its `ARCHITECTURE.md`.
**Apply here:** this is where our leads should *go*. Two concrete borrows:
- **Sequenced outreach** on top of our CRM (`/crm`) — turn a scored lead into an email
  sequence with follow-ups, sent from the user's own mailbox.
- **Learn-to-rank scoring** — replace/augment our static rule+LLM scorer with their GP
  explore/exploit loop so the engine learns *this user's* ideal customer from CRM
  outcomes (replied/closed) over time.

---

## Suggested next 3 (my recommendation)

1. **`curl_cffi` in the search backends** — immediate, large reliability win, ~small diff.
2. **Hoist extraction into `scrapers/extract.py`** and reuse in the Maps crawler — DRY +
   instantly better emails/phones on Maps leads.
3. **firecrawl-style `/map` pre-pass** before HTTrack — mirror contact/about/team pages
   first for faster, richer website leads.

Everything above is additive and platform-shaped: each slots into the existing
`platform` model (engine scraper → `/api/scrape` route → scored → CRM), so we can ship
them one at a time.
