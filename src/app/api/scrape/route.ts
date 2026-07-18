import { NextRequest, NextResponse } from 'next/server';
import { scoreLead, optimizeSearchQuery, AiPref } from '@/lib/nim';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform = 'gmaps', platforms, keyword, niche, location, limit = 10, apiKey, aiProvider, aiModel, searchMode = 'auto', websiteUrl, crawlDepth, groupName } = body;

    // Support comma-separated platforms (e.g. "reddit,x,linkedin") or single platform
    const activePlatform = platforms || platform;

    // AI preference for this request. Keys live in the server pool (seeded from
    // .env.local + added via the UI); these bias provider/model + optional override.
    const aiPref: AiPref = {
      preferProvider: aiProvider,
      preferModel: aiModel,
      clientKey: apiKey || undefined,
      clientProvider: aiProvider,
      clientModel: aiModel,
    };

    let fetchUrl = '';
    let searchQuery = '';

    if (activePlatform === 'gmaps') {
      if (!niche || !location) {
        return NextResponse.json({ error: 'Missing niche/location for Gmaps' }, { status: 400 });
      }
      const optimizedNiche = await optimizeSearchQuery(niche, 'Google Maps', aiPref);
      searchQuery = `${optimizedNiche} in ${location}`;
      fetchUrl = `http://127.0.0.1:8000/scrape?niche=${encodeURIComponent(optimizedNiche)}&location=${encodeURIComponent(location)}&limit=${limit}`;
    } else if (activePlatform === 'website') {
      // HTTrack website mirror. The seed URL rides in websiteUrl (preferred) or
      // falls back to keyword. No query optimization — it's a URL, not a search.
      const seed = (websiteUrl || keyword || '').trim();
      if (!seed) {
        return NextResponse.json({ error: 'Missing website URL for the website mirror.' }, { status: 400 });
      }
      const depth = Math.max(1, Math.min(Number(crawlDepth) || 2, 4));
      // Give deeper crawls a bigger time budget; keep it bounded.
      const maxTime = Math.min(60 + depth * 30, 300);
      searchQuery = `[website] ${seed}`;
      fetchUrl = `http://127.0.0.1:8000/scrape-website?url=${encodeURIComponent(seed)}&depth=${depth}&max_time=${maxTime}`;
    } else {
      if (!keyword) {
        return NextResponse.json({ error: 'Missing keyword for social scrape' }, { status: 400 });
      }
      const optimizedKeyword = await optimizeSearchQuery(keyword, activePlatform, aiPref);
      searchQuery = `[${activePlatform}] ${optimizedKeyword}`;
      fetchUrl = `http://127.0.0.1:8000/scrape-social?platform=${encodeURIComponent(activePlatform)}&keyword=${encodeURIComponent(optimizedKeyword)}&limit=${limit}&search_mode=${encodeURIComponent(searchMode)}`;
    }

    const batchId = crypto.randomUUID();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let pythonResponse: Response;
          try {
            pythonResponse = await fetch(fetchUrl, { 
              cache: 'no-store',
              signal: req.signal
            });
          } catch (fetchError: any) {
            // EDGE CASE: Python backend unreachable (connection refused, ECONNREFUSED, etc.)
            const isConnRefused = fetchError.cause?.code === 'ECONNREFUSED' || fetchError.message?.includes('ECONNREFUSED') || fetchError.message?.includes('fetch failed');
            const errorMsg = isConnRefused
              ? 'Python scraping backend is not running. Start it with: uvicorn main:app --port 8000'
              : `Failed to connect to scraping backend: ${fetchError.message}`;
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: errorMsg }) + '\n'));
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
            controller.close();
            return;
          }
          
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
                if (rawLead.type === 'rate_limited') {
                    // Pass the cooldown notice straight through so the UI can pop a dialog
                    // and stop hitting that platform — protects the IP from a ban.
                    controller.enqueue(encoder.encode(JSON.stringify(rawLead) + '\n'));
                    continue;
                }

                // EDGE CASE: If lead has no name, use author or title as fallback
                if (!rawLead.name) {
                  rawLead.name = rawLead.author || rawLead.title || 'Unknown Lead';
                }

                // EDGE CASE: If external_id is present, use it as the lead's id for dedup
                if (rawLead.external_id) {
                  rawLead.id = rawLead.external_id;
                } else {
                  // If ID is already provided by python, use it, otherwise generate one based on name
                  rawLead.id = rawLead.id || rawLead.name.replace(/\s+/g, '-').toLowerCase().substring(0, 50);
                }

                // Send raw lead
                console.log("Sending raw lead to frontend:", rawLead.name);
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'raw', data: rawLead }) + '\n'));
                
                // AI Score
                console.log("Scoring lead:", rawLead.name);
                const scoredLead = await scoreLead(rawLead, aiPref);
                console.log("Scored lead:", scoredLead.name);

                // Preserve fields the scorer may not echo back, so the live
                // export (and CSV/Excel) has the Maps link + grouping metadata.
                (scoredLead as any).google_maps_url = rawLead.google_maps_url || rawLead.url || (scoredLead as any).google_maps_url || null;
                (scoredLead as any).group_name = (groupName && String(groupName).trim()) || null;
                (scoredLead as any).location = location || null;
                
                // Save to DB (UPSERT) — includes all new social lead columns
                try {
                  await query(
                    `INSERT INTO gmaps_leads
                      (id, batch_id, search_query, name, address, phone, website, rating, reviews, category, emails_found, socials, about_snippet, is_claimed, lead_score, lead_category, rationale, suggested_pitch, suggested_subject, platform, external_id, kind, author, author_url, post_url, post_content, title, matched_keyword, pain_point, posted_at, group_name, location, google_maps_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
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
                      platform = EXCLUDED.platform,
                      kind = EXCLUDED.kind,
                      author = EXCLUDED.author,
                      author_url = EXCLUDED.author_url,
                      post_url = EXCLUDED.post_url,
                      post_content = EXCLUDED.post_content,
                      title = EXCLUDED.title,
                      matched_keyword = EXCLUDED.matched_keyword,
                      pain_point = EXCLUDED.pain_point,
                      posted_at = EXCLUDED.posted_at,
                      group_name = EXCLUDED.group_name,
                      location = EXCLUDED.location,
                      google_maps_url = EXCLUDED.google_maps_url,
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
                      scoredLead.suggested_subject || null,
                      scoredLead.platform || activePlatform || 'gmaps',
                      scoredLead.external_id || null,
                      scoredLead.kind || (activePlatform === 'gmaps' ? 'business_listing' : 'post'),
                      scoredLead.author || null,
                      scoredLead.author_url || null,
                      scoredLead.post_url || null,
                      scoredLead.post_content || null,
                      scoredLead.title || null,
                      scoredLead.matched_keyword || null,
                      scoredLead.pain_point || null,
                      scoredLead.posted_at || null,
                      (groupName && String(groupName).trim()) || null,
                      location || null,
                      rawLead.google_maps_url || rawLead.url || null,
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
