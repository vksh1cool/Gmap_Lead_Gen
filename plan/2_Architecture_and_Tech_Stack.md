# 2. Architecture & Tech Stack

## System Architecture

```text
                  ┌───────────────┐
   User Input ───▶│ Next.js UI    │  Inbox-style dashboard
                  └───────┬───────┘
                          ▼  (Niche, Location, Radius, Lead Count Limit)
                  ┌───────────────┐
                  │ Next.js API   │  /api/scrape endpoint
                  └───────┬───────┘
                          ▼
             ┌─────────────────────────┐
             │ Puppeteer Engine        │ 
             │ (Google Maps Scraper)   │
             └────────────┬────────────┘
                          ▼  (Raw Maps Data: Name, Address, Phone, Website)
             ┌─────────────────────────┐
             │ Puppeteer Web Crawler   │
             │ (Brand Researcher)      │
             └────────────┬────────────┘
                          ▼  (Extracted Emails, Demos, Contact Pages)
             ┌─────────────────────────┐
             │ NVIDIA NIM AI Scorer    │
             │ (Meta Llama 3 70B)      │
             └────────────┬────────────┘
                          ▼  (JSON: Quality Score, Pain Points, Strategy)
                  ┌───────────────┐
   Leads Feed ◀───│ UI Inbox Sync │
                  └───────────────┘
                          ▼
                     [Export CSV]
```

## Tech Stack
- **Frontend & Backend**: Next.js 14/15 (App Router).
- **Styling**: Vanilla CSS or Tailwind CSS (Premium Aesthetic).
- **Icons**: Lucide React.
- **Scraper**: `puppeteer` + `puppeteer-extra` + `puppeteer-extra-plugin-stealth` (to avoid Google Captchas).
- **AI Processing**: OpenAI Node SDK configured to use `https://integrate.api.nvidia.com/v1` and the provided NIM API key.
- **Data Export**: `json2csv` or standard CSV stringification for immediate download.
