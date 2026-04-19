import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function checkPassword(body: Record<string, unknown>): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return true;
  return body.password === adminPassword;
}

// GET /api/admin/reviews?password=xxx&status=pending
export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password') ?? '';
  if (!checkPassword({ password: pw })) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('business_reviews')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data: data ?? [] });
}

// POST /api/admin/reviews
// body: { password, items: [{b_no, old_nm, new_nm}] }
// 수동 검증 결과를 business_reviews에 기록하고 businesses 테이블에 반영
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

  const { error: reviewError } = await supabase
    .from('business_reviews')
    .upsert(
      items.map(item => ({
        b_no: item.b_no,
        current_nm: item.old_nm,
        suggested_nm: item.new_nm,
        suggested_sector: null,
        suggested_type: null,
        api_source: 'manual',
        status: 'approved',
        updated_at: now,
      })),
      { onConflict: 'b_no' }
    );

  if (reviewError) return Response.json({ error: reviewError.message }, { status: 500 });

  for (const item of items) {
    const { error: bizError } = await supabase
      .from('businesses')
      .update({ b_nm: item.new_nm, updated_at: now, public_api_synced_at: now })
      .eq('b_no', item.b_no);
    if (bizError) return Response.json({ error: bizError.message }, { status: 500 });
  }

  return Response.json({ success: true, applied: items.length });
}

// PATCH /api/admin/reviews
// body: { password, id, action: 'approve'|'reject', b_nm?, b_sector?, b_type? }
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const { id, b_no, action, b_nm, b_sector, b_type } = body as {
    id: number;
    b_no: string;
    action: 'approve' | 'reject';
    b_nm?: string;
    b_sector?: string;
    b_type?: string;
  };

  if (!id || !b_no || !action) {
    return Response.json({ error: 'id, b_no, action 필드가 필요합니다.' }, { status: 400 });
  }

  const supabase = getSupabase();

  if (action === 'approve') {
    // businesses 테이블 업데이트
    const updateFields: Record<string, string> = {
      updated_at: new Date().toISOString(),
      public_api_synced_at: new Date().toISOString(),
    };
    if (b_nm) updateFields.b_nm = b_nm;
    if (b_sector) updateFields.b_sector = b_sector;
    if (b_type) updateFields.b_type = b_type;

    const { error: bizError } = await supabase
      .from('businesses')
      .update(updateFields)
      .eq('b_no', b_no);

    if (bizError) return Response.json({ error: bizError.message }, { status: 500 });
  }

  // 리뷰 상태 업데이트
  const { error: reviewError } = await supabase
    .from('business_reviews')
    .update({ status: action === 'approve' ? 'approved' : 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (reviewError) return Response.json({ error: reviewError.message }, { status: 500 });
  return Response.json({ success: true });
}
