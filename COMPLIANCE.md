# Compliance & Responsible-Scraping Guide

This tool collects **publicly listed business information** to help a team find
prospects to reach out to manually. It is not a bulk-mailer and it does not
bypass logins, paywalls, or anti-bot controls. This document is the honest
picture of what's legal, what's grey, and how the app is built to stay on the
right side of the line.

> **Not legal advice.** This is engineering guidance written for a founder, not
> a lawyer's opinion. For anything high-stakes, check with counsel.

---

## 1. The one principle that drives everything

**Identify yourself; keep a human in the loop; only touch public data.**

Every regulation below points the same way. The instinct to "stay anonymous so
it can't be traced back" is exactly backwards — the laws that govern outreach
*require* a real, contactable sender. Anonymity doesn't make questionable
outreach legal; it makes otherwise-fine outreach illegal. So the app is designed
to surface data for a person to review and send **from their real identity**, not
to blast messages from behind a mask.

---

## 2. Indian law that applies

### Information Technology Act, 2000 (as amended)
- **§43 / §43A** — penalise *unauthorised* access, downloading, or extraction
  from a computer resource, and negligent handling of sensitive data. The safe
  reading: don't defeat access controls, don't log in and scrape behind auth,
  don't hammer a host hard enough to degrade it (that edges toward "denial of
  service"). Reading *public* pages at a polite rate is not "unauthorised
  access."
- **§66** — computer-related offences built on §43. Same guardrails.
- **§66A** was struck down (*Shreya Singhal v. Union of India*, 2015), but
  sending menacing/spam messages can still attract other provisions.

**How the app complies:** it only reads public listings and public business
websites, honours `robots.txt` where a crawler is used, rate-limits every
source, and never authenticates into a platform to extract gated data.

### Digital Personal Data Protection Act, 2023 (DPDP)
- Governs processing of **personal data** of individuals (a named person's
  email/phone), not a company's generic `info@` line.
- **§3(c)(ii)** carves out personal data that the individual **made publicly
  available** themselves, or that is public under a legal duty. Public business
  directory listings largely fall here — which is precisely why this tool
  targets *listed business contacts*, not scraped personal profiles.
- The moment you use personal data for outreach you're a **Data Fiduciary**:
  you must be identifiable, have a lawful basis, honour erasure/opt-out, and not
  retain data beyond its purpose.

**How the app complies:** it prefers business-level contacts (listed phone,
`info@`, contact form), stores only what's needed for outreach review, and
leaves the send decision to a human who acts under their real identity. See
§6 for the retention/opt-out checklist.

### TRAI / telemarketing & DND
- Unsolicited **commercial calls/SMS** to Indian numbers are regulated (TRAI TCCCPR,
  the DND registry). Cold *email* to a business is more tolerated than cold SMS,
  but B2B still means: relevant, honest, easy to opt out of.

---

## 3. If any recipient is outside India

- **GDPR / UK GDPR + PECR (EU/UK):** B2B cold email needs a lawful basis
  (usually legitimate interest) plus a clear opt-out and sender identity.
  Individuals' personal emails get more protection than role addresses.
- **CAN-SPAM (US):** legal cold email is allowed but **requires** a truthful
  "from", a real physical postal address, and a working unsubscribe. Note the
  direction again — the law *mandates* identifying yourself.

---

## 4. Platform terms & the data sources this app uses

| Source | What we do | Standing |
|---|---|---|
| **OpenStreetMap (Overpass/Nominatim)** — default | Query open POI data | ✅ Open data under **ODbL**. Free, no key. Just be polite + attribute (see §5). |
| **Business's own website** | Fetch homepage/contact page for public email/phone | ✅ Public pages, `robots.txt`-aware, one light request. |
| **Google Maps (headless browser)** — opt-in | Read public listing fields | ⚠️ Against Google's ToS to scrape the Maps UI. Off by default. The *supported* path is the Places API (needs billing). Use sparingly and at your own risk. |
| **Social/Q&A dorking** — opt-in | Public search results | ⚠️ Grey. Public posts, but many platform ToS forbid automated collection. Rate-limited + circuit-broken; treat as research, not bulk harvest. |

**Recommendation:** default to **OpenStreetMap + website enrichment**. It's the
only path here that's clearly clean. Everything else is a knowing trade-off.

---

## 5. OpenStreetMap usage policy (we follow these)

Overpass and Nominatim are donated infrastructure. The app respects their rules:
- **Identifying User-Agent** on every request (set `OSM_CONTACT` /
  `OSM_USER_AGENT` in `python_engine/.env`). A genuine UA is *required* by
  Nominatim — this is compliance, not fingerprinting.
- **One** geocode call per search; **one** Overpass query (server-side timeout),
  with mirror failover instead of retry-hammering.
- Reasonable result caps; not a substitute for a bulk data download.
- **Attribution:** anything you publish from this data must credit
  "© OpenStreetMap contributors" (ODbL). Internal prospecting lists don't need a
  visible credit, but keep the attribution if you redistribute.

---

## 6. Outreach checklist (the human's job, not the app's)

The app **does not send anything**. When you review a lead and decide to reach
out, do it under your real identity and:

- [ ] Contact is a **business/role** address or a person who published it for
      business contact.
- [ ] Message is **relevant** to what they actually do (the app's pain-point +
      service-fit fields help you keep it specific, not spammy).
- [ ] Your real **name, company, and a physical address** are present.
- [ ] A one-click **opt-out** is offered and honoured immediately.
- [ ] You **delete** contacts who opt out or don't fit, and don't hoard data.
- [ ] You are **not** messaging DND-registered numbers with marketing SMS.

---

## 7. What this tool deliberately does NOT do

- ❌ No automated sending / mass mailing — every message is a human decision.
- ❌ No bypassing logins, CAPTCHAs, or paywalls.
- ❌ No identity-obfuscation stack (Tor/proxychains/fingerprint-scrubbing to
      "avoid traceback"). That doesn't reduce legal risk — under CAN-SPAM/DPDP
      it *is* the violation — and it's outside this project's scope.
- ❌ No scraping of gated personal profiles or harvesting of sensitive personal
      data.

Rate-limiting, jitter, and reasonable proxy rotation *are* included — but as
**host-politeness** (don't overload a server, don't trip a ban), not as evasion.

---

## 8. Config knobs that matter for compliance

| Setting | Where | Effect |
|---|---|---|
| `OSM_CONTACT` | `python_engine/.env` | Adds your contact to the OSM User-Agent (recommended). |
| Data source toggle | Scraper UI | Keep on **OpenStreetMap** for the clean path. |
| `limit` | Scraper UI | Keep modest — smaller, targeted pulls are both politer and higher-quality. |
| Rate limits / circuit breaker | `scrapers/rate_limiter.py` | Per-platform pacing + auto-backoff on blocks. Don't raise blindly. |
