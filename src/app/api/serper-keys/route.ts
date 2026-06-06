import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ENGINE = process.env.PYTHON_ENGINE_URL || 'http://127.0.0.1:8000';

// Proxies the Serper key-pool endpoints to the Python engine (server-side, no CORS).

export async function GET() {
  try {
    const r = await fetch(`${ENGINE}/serper-keys`, { cache: 'no-store' });
    return NextResponse.json(await r.json());
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Scraping engine not reachable. Start it: uvicorn main:app --port 8000', detail: e.message },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { key } = await req.json();
    if (!key || typeof key !== 'string' || key.trim().length < 8) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }
    const r = await fetch(`${ENGINE}/serper-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key.trim() }),
    });
    return NextResponse.json(await r.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const tail = new URL(req.url).searchParams.get('tail');
    if (!tail) return NextResponse.json({ error: 'Missing tail' }, { status: 400 });
    const r = await fetch(`${ENGINE}/serper-keys/${encodeURIComponent(tail)}`, { method: 'DELETE' });
    return NextResponse.json(await r.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
