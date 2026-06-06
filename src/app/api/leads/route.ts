import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM gmaps_leads ORDER BY scraped_at DESC LIMIT 500`
    );
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
