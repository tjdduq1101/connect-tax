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
// 폐업 사업자를 businesses + business_reviews에서 배치 단위로 삭제
// body: { password, offset?: number, limit?: number }
// 반환: { processed, deleted, hasMore, nextOffset }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const offset: number = typeof body.offset === 'number' ? body.offset : 0;
  const limit: number = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 100;

  const supabase = getSupabase();

  const { data: reviews, error } = await supabase
    .from('business_reviews')
    .select('id, b_no')
    .eq('status', 'pending')
    .range(offset, offset + limit - 1);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!reviews || reviews.length === 0) {
    return Response.json({ processed: 0, deleted: 0, hasMore: false, nextOffset: offset });
  }

  const bnos = (reviews as { id: number; b_no: string }[]).map(r => r.b_no);
  const ntsMap = await fetchNtsStatusMap(bnos);

  const closedBnos = (reviews as { id: number; b_no: string }[])
    .filter(r => ntsMap[r.b_no] === '03')
    .map(r => r.b_no);

  if (closedBnos.length > 0) {
    const { error: deleteReviewError } = await supabase
      .from('business_reviews')
      .delete()
      .in('b_no', closedBnos);
    if (deleteReviewError) return Response.json({ error: deleteReviewError.message }, { status: 500 });

    const { error: deleteBizError } = await supabase
      .from('businesses')
      .delete()
      .in('b_no', closedBnos);
    if (deleteBizError) return Response.json({ error: deleteBizError.message }, { status: 500 });
  }

  return Response.json({
    processed: reviews.length,
    deleted: closedBnos.length,
    hasMore: reviews.length === limit,
    nextOffset: offset + reviews.length,
  });
}
