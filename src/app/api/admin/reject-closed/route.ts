import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { fetchNtsStatusMap } from '@/lib/ntsStatus';

export const maxDuration = 60;

function checkPassword(body: Record<string, unknown>): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return body.password === adminPassword;
}

// POST /api/admin/reject-closed
// needs_review 상태의 폐업 사업자를 businesses에서 배치 삭제
// body: { password, limit?: number }
// 반환: { processed, deleted, hasMore }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const limit: number = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 100;
  const supabase = getSupabase();

  const { data: records, error } = await supabase
    .from('businesses')
    .select('b_no')
    .eq('verify_status', 'needs_review')
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!records || records.length === 0) {
    return Response.json({ processed: 0, deleted: 0, hasMore: false });
  }

  const bnos = (records as { b_no: string }[]).map(r => r.b_no);
  const ntsMap = await fetchNtsStatusMap(bnos);

  const closedBnos = bnos.filter(bno => ntsMap[bno] === '03');

  if (closedBnos.length > 0) {
    const { error: deleteError } = await supabase
      .from('businesses')
      .delete()
      .in('b_no', closedBnos);
    if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return Response.json({
    processed: records.length,
    deleted: closedBnos.length,
    hasMore: records.length === limit,
  });
}
