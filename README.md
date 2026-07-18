<div align="center">
  <img src="public/logo.png" alt="Gmap Lead Gen Logo" width="200"/>
  <h1>Gmap Lead Gen</h1>
  <p><strong>A high-performance Google Maps lead scraping & CRM tool.</strong></p>
  
  [![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC)](https://tailwindcss.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6)](https://www.typescriptlang.org/)
</div>

<br />

## 🚀 Overview

**Gmap Lead Gen** is a modern, fast, and robust lead generation engine that extracts high-intent business leads from **Google Maps and 10+ social platforms** — Reddit, X (Twitter), LinkedIn, Hacker News, Dev.to, StackOverflow, ProductHunt, Upwork, IndiaMART, JustDial, and more. It pairs a stealth Python scraping engine with an AI-powered intent scorer and a sleek, CRM-like Next.js dashboard for managing your pipeline end-to-end.

## ✨ Features

- **Multi-Platform Scraping:** Google Maps, Reddit, X, LinkedIn, Hacker News, Dev.to, StackOverflow, ProductHunt, Upwork, IndiaMART, JustDial, and Dark Web sources.
- **AI Intent Scoring:** Automatically scores leads for buyer intent using Groq, NVIDIA NIM, OpenAI, or Gemini.
- **Google Dorking Engine:** Advanced `site:` dork queries with intent suffixes to surface high-value leads from any platform.
- **Modern CRM Dashboard:** Built with Next.js App Router for a lightning-fast lead management experience.
- **Real-Time Data:** Live database connection via Neon Postgres with robust error handling and connection fallback.
- **Beautiful UI:** Dark-mode, premium aesthetic with animated blobs, noise textures, and glassmorphism.
- **Export to Excel:** One-click export of your leads pipeline.

## 📦 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- A Neon Postgres Database (for lead storage)
- At least one AI API key (Groq, NVIDIA NIM, OpenAI, or Gemini) for intent scoring

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/Gmap_Lead_Gen.git
   cd Gmap_Lead_Gen
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Environment Variables**
   Copy the example file and fill in your keys:
   ```bash
   cp .env.local.example .env.local
   ```
   At minimum, set your `DATABASE_URL`. See [`.env.local.example`](.env.local.example) for all available options.

4. **Run the Development Server**
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the dashboard.

## 🛠 Tech Stack

- **Frontend:** Next.js 14, React 18, Tailwind CSS, Lucide Icons
- **Backend:** Node.js API Routes, Python Scraping Engine (FastAPI)
- **AI:** Groq / NVIDIA NIM / OpenAI / Gemini (auto-fallback)
- **Database:** Neon Serverless Postgres

## 📝 License

This project is licensed under the MIT License.
