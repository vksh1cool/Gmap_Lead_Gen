import { NextRequest, NextResponse } from 'next/server';
import { listStatus, addKey, removeKey, resetAll, validateKey, PROVIDERS, AiProvider } from '@/lib/aiKeyPool';
import { cacheStats, cacheClear } from '@/lib/aiCache';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ...listStatus(), cache: cacheStats() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = body.provider as AiProvider;
    const key = (body.key || '').trim();
    const model = body.model?.trim() || undefined;
    const skipValidate = !!body.skipValidate;

    if (!PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: `Unknown provider "${provider}"` }, { status: 400 });
    }
    if (!key || key.length < 8) {
      return NextResponse.json({ error: 'That key looks too short.' }, { status: 400 });
    }

    // Live-validate before adding, unless explicitly skipped (offline add).
    if (!skipValidate) {
      const v = await validateKey(provider, key, model);
      if (!v.ok) {
        return NextResponse.json({ error: `Key rejected — ${v.reason}` }, { status: 400 });
      }
    }

    addKey(provider, key, model);
    return NextResponse.json(listStatus());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const action = searchParams.get('action');
    if (action === 'reset') {
      resetAll();
      return NextResponse.json({ ...listStatus(), cache: cacheStats() });
    }
    if (action === 'clear-cache') {
      cacheClear();
      return NextResponse.json({ ...listStatus(), cache: cacheStats() });
    }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    removeKey(id);
    return NextResponse.json({ ...listStatus(), cache: cacheStats() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
