import { NextRequest, NextResponse } from 'next/server';
import { analyzeIntent } from '@/lib/nim';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { intent, platforms, niche, location, apiKey, aiProvider, aiModel } = body;

    if (!intent) {
      return NextResponse.json({ error: 'Intent is required' }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API Key is required' }, { status: 400 });
    }

    const options = await analyzeIntent(intent, platforms, niche, location, apiKey, aiProvider, aiModel);

    return NextResponse.json({ options });
  } catch (error: any) {
    console.error('Error analyzing intent:', error);
    return NextResponse.json({ error: error.message || 'Failed to analyze intent' }, { status: 500 });
  }
}
