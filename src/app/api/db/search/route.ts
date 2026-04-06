import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const bno = request.nextUrl.searchParams.get('bno');
  if (!bno) return Response.json({ error: 'bno 파라미터가 필요합니다.' }, { status: 400 });

  try {
    const supabase = getSupabase();
    const cleaned = bno.replace(/-/g, '');
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('b_no', cleaned)
      .single();

    if (error || !data) return Response.json({ data: null });
    return Response.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
