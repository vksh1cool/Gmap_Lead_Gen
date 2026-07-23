import { NextRequest, NextResponse } from 'next/server';
import { analyzeIntent } from '@/lib/nim';
import { hasAnyKey } from '@/lib/aiKeyPool';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { intent, platforms, niche, location, apiKey, aiProvider, aiModel, offer } = body;

    if (!intent) {
      return NextResponse.json({ error: 'Intent is required' }, { status: 400 });
    }

    // Keys come from the server-side pool (seeded from .env.local + added in UI).
    // apiKey (if the client sent one) is an optional highest-priority override.
    if (!hasAnyKey() && !apiKey) {
      return NextResponse.json({
        error: 'No AI key configured. Add a Groq or NIM key in Settings → AI Key Pool, or in .env.local (groq_api_key / nim_key).',
      }, { status: 400 });
    }

    const options = await analyzeIntent(intent, platforms, niche, location, {
      preferProvider: aiProvider,
      preferModel: aiModel,
      clientKey: apiKey || undefined,
      clientProvider: aiProvider,
      clientModel: aiModel,
      offer,
    });

    return NextResponse.json({ options });
  } catch (error: any) {
    console.error('Error analyzing intent:', error);
    return NextResponse.json({ error: error.message || 'Failed to analyze intent' }, { status: 500 });
  }
}
