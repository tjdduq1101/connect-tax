import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function checkPassword(body: Record<string, unknown>): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return body.password === adminPassword;
}

// GET /api/admin/reviews?password=xxx&limit=50&offset=0&source=verifiable|unverifiable
// businesses 테이블에서 verify_status='needs_review' 인 레코드 조회
export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password') ?? '';
  if (!checkPassword({ password: pw })) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10);
  const source = request.nextUrl.searchParams.get('source');
  const supabase = getSupabase();

  let query = supabase
    .from('businesses')
    .select('b_no, b_nm, suggested_nm, suggested_sector, suggested_type, api_source, verify_status, updated_at', { count: 'exact' })
    .eq('verify_status', 'needs_review')
    .order('updated_at', { ascending: false });

  if (source === 'unverifiable') query = query.eq('api_source', 'unverifiable');
  else if (source === 'verifiable') query = query.neq('api_source', 'unverifiable');

  if (limit > 0) query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data: data ?? [], total: count ?? 0 });
}

// POST /api/admin/reviews
// 수동 검증 결과를 businesses에 needs_review로 저장
// body: { password, items: [{b_no, old_nm, new_nm}] }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const { items } = body as { items: { b_no: string; old_nm: string | null; new_nm: string }[] };
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: 'items 배열이 필요합니다.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  for (const item of items) {
    const { error } = await supabase
      .from('businesses')
      .update({
        verify_status: 'needs_review',
        suggested_nm: item.new_nm,
        api_source: 'manual',
        updated_at: now,
      })
      .eq('b_no', item.b_no);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, applied: items.length });
}

// PATCH /api/admin/reviews
// 단건: { password, b_no, action: 'approve'|'reject', b_nm?, b_sector?, b_type? }
// 일괄: { password, b_nos: string[], action: 'approve'|'reject' }
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // 일괄 처리
  if (Array.isArray(body.b_nos) && body.b_nos.length > 0) {
    const { b_nos, action } = body as { b_nos: string[]; action: 'approve' | 'reject' };

    if (action === 'approve') {
      // 각 레코드의 suggested 값을 읽어서 실제 컬럼에 반영
      const { data: records, error: fetchError } = await supabase
        .from('businesses')
        .select('b_no, suggested_nm, suggested_sector, suggested_type')
        .in('b_no', b_nos);
      if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

      for (const r of (records ?? []) as { b_no: string; suggested_nm: string | null; suggested_sector: string | null; suggested_type: string | null }[]) {
        const updateFields: Record<string, string | null> = {
          verify_status: 'verified',
          updated_at: now,
          public_api_synced_at: now,
          suggested_nm: null,
          suggested_sector: null,
          suggested_type: null,
          api_source: null,
        };
        if (r.suggested_nm) updateFields.b_nm = r.suggested_nm;
        if (r.suggested_sector) updateFields.b_sector = r.suggested_sector;
        if (r.suggested_type) updateFields.b_type = r.suggested_type;

        const { error } = await supabase.from('businesses').update(updateFields).eq('b_no', r.b_no);
        if (error) return Response.json({ error: error.message }, { status: 500 });
      }
    } else {
      // reject: 현재 이름 유지, verified 처리
      const { error } = await supabase
        .from('businesses')
        .update({
          verify_status: 'verified',
          suggested_nm: null,
          suggested_sector: null,
          suggested_type: null,
          api_source: null,
          updated_at: now,
        })
        .in('b_no', b_nos);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, processed: b_nos.length });
  }

  // 단건 처리
  const { b_no, action, b_nm, b_sector, b_type } = body as {
    b_no: string;
    action: 'approve' | 'reject';
    b_nm?: string;
    b_sector?: string;
    b_type?: string;
  };

  if (!b_no || !action) {
    return Response.json({ error: 'b_no, action 필드가 필요합니다.' }, { status: 400 });
  }

  if (action === 'approve') {
    // 수정된 값이 있으면 사용, 없으면 suggested 값 사용
    let finalNm = b_nm;
    let finalSector = b_sector;
    let finalType = b_type;

    if (!finalNm) {
      const { data } = await supabase
        .from('businesses')
        .select('suggested_nm, suggested_sector, suggested_type')
        .eq('b_no', b_no)
        .maybeSingle();
      if (data) {
        finalNm = finalNm || data.suggested_nm;
        finalSector = finalSector || data.suggested_sector;
        finalType = finalType || data.suggested_type;
      }
    }

    const updateFields: Record<string, string | null> = {
      verify_status: 'verified',
      updated_at: now,
      public_api_synced_at: now,
      suggested_nm: null,
      suggested_sector: null,
      suggested_type: null,
      api_source: null,
    };
    if (finalNm) updateFields.b_nm = finalNm;
    if (finalSector) updateFields.b_sector = finalSector;
    if (finalType) updateFields.b_type = finalType;

    const { error } = await supabase.from('businesses').update(updateFields).eq('b_no', b_no);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    // reject: 현재 이름 유지, verified 처리
    const { error } = await supabase
      .from('businesses')
      .update({
        verify_status: 'verified',
        suggested_nm: null,
        suggested_sector: null,
        suggested_type: null,
        api_source: null,
        updated_at: now,
      })
      .eq('b_no', b_no);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
