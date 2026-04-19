import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

interface BusinessInfoEntry {
  b_no: string;
  b_nm?: string;
  p_nm?: string;
  biz_type?: string;
  b_sector?: string;
  b_type?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const businesses: BusinessInfoEntry[] = body.businesses;

    if (!Array.isArray(businesses) || businesses.length === 0) {
      return Response.json({ error: 'businesses 배열이 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabase();

    const rows = businesses.map((b) => ({
      b_no: b.b_no,
      b_nm: b.b_nm || null,
      p_nm: b.p_nm || null,
      biz_type: b.biz_type || null,
      b_sector: b.b_sector || null,
      b_type: b.b_type || null,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('business_info')
      .upsert(rows, { onConflict: 'b_no' });

    if (error) throw error;

    return Response.json({ success: true, count: rows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
