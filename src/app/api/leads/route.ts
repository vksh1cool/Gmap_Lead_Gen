import { NextRequest, NextResponse } from 'next/server';
import { query, DbNotConfiguredError } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get('platform');

    let sqlQuery = `SELECT id, name, address, phone, website, rating, reviews, category,
      emails_found, socials, about_snippet, is_claimed, lead_score, lead_category,
      rationale, suggested_pitch, suggested_subject, status, scraped_at,
      platform, kind, author, author_url, post_url, post_content, title,
      matched_keyword, pain_point, posted_at, external_id, batch_id, search_query,
      group_name, location, google_maps_url, coordinates, hours, price_level
      FROM gmaps_leads`;
    const params: string[] = [];

    if (platform) {
      sqlQuery += ` WHERE platform = $1`;
      params.push(platform);
    }

    sqlQuery += ` ORDER BY scraped_at DESC LIMIT 5000`;

    const result = await query(sqlQuery, params);
    return NextResponse.json({ leads: result.rows });
  } catch (error: any) {
    // No DB configured yet → return an empty pipeline with a flag, not a 500,
    // so the CRM can show a friendly "configure your database" state.
    if (error instanceof DbNotConfiguredError) {
      return NextResponse.json({ leads: [], dbConfigured: false, message: error.message });
    }
    console.error('Error fetching leads:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, status } = await req.json();
    if (!id || !status) return NextResponse.json({ error: 'Missing id or status' }, { status: 400 });

    await query(`UPDATE gmaps_leads SET status = $1 WHERE id = $2`, [status, id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating lead:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const groupName = url.searchParams.get('group');
    const batchId = url.searchParams.get('batch');

    if (id) {
      await query(`DELETE FROM gmaps_leads WHERE id = $1`, [id]);
    } else if (groupName) {
      await query(`DELETE FROM gmaps_leads WHERE group_name = $1`, [groupName]);
    } else if (batchId) {
      await query(`DELETE FROM gmaps_leads WHERE batch_id = $1`, [batchId]);
    } else {
      await query(`DELETE FROM gmaps_leads`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting lead(s):', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
