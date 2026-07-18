import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Lightweight health probe for the local Python scraping engine (port 8000).
// The sidebar polls this so the "Local Engine" indicator reflects reality
// instead of being hardcoded online.
export async function GET() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('http://127.0.0.1:8000/serper-keys', {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(t);
    return NextResponse.json({ online: res.ok });
  } catch {
    return NextResponse.json({ online: false });
  }
}
