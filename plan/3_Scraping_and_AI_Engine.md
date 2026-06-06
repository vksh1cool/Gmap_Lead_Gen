# 3. Scraping & AI Engine

## The Two-Phase Scrape

### Phase 1: Google Maps
- Navigate to Google Maps search (e.g., `https://www.google.com/maps/search/plumbers+in+austin/`).
- Wait for the results pane.
- Auto-scroll the sidebar until the desired **Lead Count Limit** is reached, or no more results exist.
- Extract:
  - `name`: Business Name
  - `rating`: Star Rating (e.g., 4.5)
  - `reviews`: Number of Reviews (e.g., 120)
  - `category`: Business Category (e.g., Plumber)
  - `address`: Full Address
  - `phone`: Phone Number
  - `website`: URL (if available)

### Phase 2: The Deep Web Crawl (Brand Research)
- If a `website` URL is found in Phase 1, Puppeteer navigates to it.
- **Extraction Goal**: 
  - Look for `mailto:` links or regex-match email addresses in the HTML.
  - Look for links to "Contact Us", "Demo", or "Book" pages.
  - Grab a snippet of the homepage text (meta description or first few paragraphs) to give the AI context on what the brand actually does.

## AI Scoring Engine (NVIDIA NIM)
The aggregated JSON payload for a single lead is sent to `meta/llama-3.3-70b-instruct` via the NVIDIA NIM API.

**Instruction to AI**:
"You are a B2B Lead Qualifier. I will give you data about a local business scraped from Google Maps and their website. Your job is NOT to filter them out, but to SCORE them on a scale of 1-10 based on how likely they are to need digital services, and tell me exactly what to pitch them.

Output strictly as JSON:
```json
{
  "lead_score": 8,
  "rationale": "High volume of reviews but no website indicates a huge missed opportunity. Prime candidate for web development.",
  "suggested_pitch": "Web Development - Highlight their strong local reputation and how a website can capture that traffic.",
  "emails_found": ["contact@example.com"] 
}
```
"
