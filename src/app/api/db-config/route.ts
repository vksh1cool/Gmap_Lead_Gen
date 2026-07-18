import { NextRequest, NextResponse } from 'next/server';
import { pingDb, testDbUrl, saveDbUrl, clearSavedDbUrl, connectionSource } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET → live DB status (configured? reachable? which source?).
export async function GET() {
  const status = await pingDb();
  return NextResponse.json(status);
}

// POST { url } → validate then persist (only used when DATABASE_URL env is absent).
export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Provide a Postgres/Neon connection URL.' }, { status: 400 });
    }
    if (connectionSource() === 'env') {
      return NextResponse.json({
        error: 'DATABASE_URL is set in your environment (.env.local) and takes precedence. Edit it there instead.',
      }, { status: 409 });
    }
    const test = await testDbUrl(url);
    if (!test.ok) {
      return NextResponse.json({ error: `Could not connect: ${test.error}` }, { status: 400 });
    }
    saveDbUrl(url);
    const status = await pingDb();
    return NextResponse.json({ ...status, saved: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE → clear the UI-saved URL (does not touch the env var).
export async function DELETE() {
  clearSavedDbUrl();
  const status = await pingDb();
  return NextResponse.json(status);
}
