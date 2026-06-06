import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get('platform');

    let sqlQuery = `SELECT id, name, address, phone, website, rating, reviews, category, 
      emails_found, socials, about_snippet, is_claimed, lead_score, lead_category, 
      rationale, suggested_pitch, suggested_subject, status, scraped_at,
      platform, kind, author, author_url, post_url, post_content, title, 
      matched_keyword, pain_point, posted_at, external_id, batch_id, search_query
      FROM gmaps_leads`;
    const params: string[] = [];

    if (platform) {
      sqlQuery += ` WHERE platform = $1`;
      params.push(platform);
    }

    sqlQuery += ` ORDER BY scraped_at DESC LIMIT 500`;

    const result = await query(sqlQuery, params);
    return NextResponse.json({ leads: result.rows });
  } catch (error: any) {
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

    if (id) {
      await query(`DELETE FROM gmaps_leads WHERE id = $1`, [id]);
    } else {
      await query(`DELETE FROM gmaps_leads`);
    }
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting lead(s):', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
