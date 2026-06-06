# 1. Overview & Goals

## The Problem
Existing lead generation tools (like N8N_Alternative or MCP Ads Server) often yield "low intent" or generic leads. For a B2B digital agency, the best leads are local businesses with clear, identifiable gaps in their digital presence (e.g., no website, poor Google reviews, missing contact info).

## The Solution: GMaps Lead Scraper
A standalone, highly-versatile Next.js application that treats Google Maps as the ultimate "gold mine" of leads. 

**Core Workflow:**
1. **Input**: User enters a Niche (e.g., "Roofers"), Location ("Austin, TX"), and Radius. Optional parameter: "Number of Leads".
2. **Deep Scrape**: The app uses Puppeteer to search Google Maps, bypassing simple API limitations, and extracts deep data.
3. **Web Crawl (The "Research")**: If the business has a website, the tool doesn't stop. It visits the website to scrape for an email address, contact page, or demo link.
4. **AI Scoring (NVIDIA NIM)**: The raw data is passed to Meta Llama 3 (via NVIDIA NIM). The AI does *not* delete leads, but *scores* them. It provides a structured evaluation: "Does this business need a website?" "Do they need reputation management?" "What is their overall lead quality score?"
5. **Inbox-Style UI**: Leads stream into a gorgeous, inbox-like UI where the user can view, filter, sort, and export the "gold" leads to CSV.

## Definition of a "Gold" Lead
- High rating but no website (Needs Web Development).
- Poor rating but has a website (Needs Reputation Management/SEO).
- Email successfully scraped from their domain (Ready for Cold Outreach).
