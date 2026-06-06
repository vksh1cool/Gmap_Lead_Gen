import { NextRequest, NextResponse } from 'next/server';
import { scoreLead } from '@/lib/nim';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { niche, location, limit = 10, apiKey, aiProvider, aiModel } = body;

    if (!niche || !location) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const batchId = crypto.randomUUID();
    const searchQuery = `${niche} in ${location}`;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const pythonResponse = await fetch(`http://127.0.0.1:8000/scrape?niche=${encodeURIComponent(niche)}&location=${encodeURIComponent(location)}&limit=${limit}`, { 
            cache: 'no-store',
            signal: req.signal
          });
          
          if (!pythonResponse.ok || !pythonResponse.body) {
             throw new Error('Python backend failed to start scraping.');
          }

          const reader = pythonResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            console.log("RECEIVED CHUNK FROM PYTHON:", chunk.substring(0, 100) + '...');
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const rawLead = JSON.parse(line);
                if (rawLead.error) {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: rawLead.error }) + '\n'));
                    continue;
                }
                if (rawLead.type === 'info') {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: 'info', message: rawLead.message }) + '\n'));
                    continue;
                }
                if (rawLead.type === 'warning') {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: 'warning', message: rawLead.message }) + '\n'));
                    continue;
                }
                if (rawLead.type === 'error') {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: rawLead.message }) + '\n'));
                    continue;
                }

                // If ID is already provided by python, use it, otherwise generate one based on name
                rawLead.id = rawLead.id || rawLead.name.replace(/\s+/g, '-').toLowerCase().substring(0, 50);

                // Send raw lead
                console.log("Sending raw lead to frontend:", rawLead.name);
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'raw', data: rawLead }) + '\n'));
                
                // AI Score
                console.log("Scoring lead:", rawLead.name);
                const scoredLead = await scoreLead(rawLead, apiKey, aiProvider, aiModel);
                console.log("Scored lead:", scoredLead.name);
                
                // Save to DB (UPSERT)
                try {
                  await query(
                    `INSERT INTO gmaps_leads 
                      (id, batch_id, search_query, name, address, phone, website, rating, reviews, category, emails_found, socials, about_snippet, is_claimed, lead_score, lead_category, rationale, suggested_pitch, suggested_subject)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                     ON CONFLICT (id) DO UPDATE SET
                      name = EXCLUDED.name,
                      address = EXCLUDED.address,
                      phone = EXCLUDED.phone,
                      website = EXCLUDED.website,
                      rating = EXCLUDED.rating,
                      reviews = EXCLUDED.reviews,
                      emails_found = EXCLUDED.emails_found,
                      socials = EXCLUDED.socials,
                      about_snippet = EXCLUDED.about_snippet,
                      is_claimed = EXCLUDED.is_claimed,
                      lead_score = EXCLUDED.lead_score,
                      lead_category = EXCLUDED.lead_category,
                      rationale = EXCLUDED.rationale,
                      suggested_pitch = EXCLUDED.suggested_pitch,
                      suggested_subject = EXCLUDED.suggested_subject,
                      scraped_at = CURRENT_TIMESTAMP`,
                    [
                      scoredLead.id,
                      batchId,
                      searchQuery,
                      scoredLead.name,
                      scoredLead.address || null,
                      scoredLead.phone || null,
                      scoredLead.website || null,
                      scoredLead.rating || null,
                      scoredLead.reviews || null,
                      scoredLead.category || null,
                      scoredLead.emails_found || [],
                      scoredLead.socials || [],
                      scoredLead.about_snippet || null,
                      scoredLead.is_claimed ?? null,
                      scoredLead.lead_score,
                      scoredLead.lead_category || null,
                      scoredLead.rationale || null,
                      scoredLead.suggested_pitch || null,
                      scoredLead.suggested_subject || null
                    ]
                  );
                } catch (dbError: any) {
                  console.error("DB Insert Error:", dbError.message);
                }
                
                // Send scored lead
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'scored', data: scoredLead }) + '\n'));
              } catch (e) {
                 console.error("JSON parse error:", e);
              }
            }
          }
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
        } catch (e: any) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: e.message }) + '\n'));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
