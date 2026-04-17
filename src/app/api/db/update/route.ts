import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

interface UpdatePayload {
  b_no: string;
  b_nm?: string;
  p_nm?: string;
  b_sector?: string;
  b_type?: string;
  b_adr?: string;
}

export async function PATCH(request: NextRequest) {
  try {
    const body: UpdatePayload = await request.json();
    if (!body.b_no) {
      return Response.json({ error: 'b_no가 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from('businesses')
      .update({
        ...(body.b_nm !== undefined && { b_nm: body.b_nm }),
        ...(body.p_nm !== undefined && { p_nm: body.p_nm }),
        ...(body.b_sector !== undefined && { b_sector: body.b_sector }),
        ...(body.b_type !== undefined && { b_type: body.b_type }),
        ...(body.b_adr !== undefined && { b_adr: body.b_adr }),
        public_api_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('b_no', body.b_no.replace(/-/g, ''));

    if (error) throw error;
    return Response.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
