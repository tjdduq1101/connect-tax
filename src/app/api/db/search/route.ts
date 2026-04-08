import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const bno = request.nextUrl.searchParams.get('bno');
  const name = request.nextUrl.searchParams.get('name');

  if (!bno && !name) return Response.json({ error: 'bno 또는 name 파라미터가 필요합니다.' }, { status: 400 });

  try {
    const supabase = getSupabase();

    // 사업자번호로 검색
    if (bno) {
      const cleaned = bno.replace(/-/g, '');
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('b_no', cleaned)
        .single();

      if (error || !data) return Response.json({ data: null });
      return Response.json({ data });
    }

    // 거래처명으로 검색 (ilike 부분 매칭)
    if (name) {
      const cleaned = name.replace(/주식회사|（주）|\(주\)|㈜|유한회사/g, '').trim();
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .ilike('b_nm', `%${cleaned}%`)
        .limit(1)
        .single();

      if (error || !data) return Response.json({ data: null });
      return Response.json({ data });
    }

    return Response.json({ data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
