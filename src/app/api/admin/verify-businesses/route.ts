import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { fetchPublicBusinessInfo } from '@/lib/publicBusinessApi';
import { fetchNtsStatusMap } from '@/lib/ntsStatus';

export const maxDuration = 60;

function checkPassword(body: Record<string, unknown>): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return body.password === adminPassword;
}

function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜|\s)/g, '').toLowerCase();
}

interface DbRecord {
  b_no: string;
  b_nm: string | null;
}

// POST /api/admin/verify-businesses
// unscanned 상태의 businesses를 공공API와 대조 후 직접 업데이트
// body: { password, limit?: number }
// 반환: { processed, verified, needsReview, deleted, unverifiable, hasMore }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const limit: number = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 50;
  const supabase = getSupabase();

  const { data: records, error } = await supabase
    .from('businesses')
    .select('b_no, b_nm')
    .eq('verify_status', 'unscanned')
    .not('b_no', 'like', 'nm_%')
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!records || records.length === 0) {
    return Response.json({ processed: 0, verified: 0, needsReview: 0, deleted: 0, unverifiable: 0, hasMore: false });
  }

  const now = new Date().toISOString();
  const typedRecords = records as DbRecord[];

  // 1단계: NTS 폐업 체크 → 삭제
  const bnos = typedRecords.map(r => r.b_no);
  const ntsMap = await fetchNtsStatusMap(bnos);
  const closedBnos = typedRecords.filter(r => ntsMap[r.b_no] === '03').map(r => r.b_no);
  const activeRecords = typedRecords.filter(r => ntsMap[r.b_no] !== '03');

  if (closedBnos.length > 0) {
    await supabase.from('businesses').delete().in('b_no', closedBnos);
  }

  // 2단계: 공공API 대조
  let verified = 0, needsReview = 0, unverifiable = 0;
  const CONCURRENT = 3;

  for (let i = 0; i < activeRecords.length; i += CONCURRENT) {
    const batch = activeRecords.slice(i, i + CONCURRENT);
    await Promise.all(batch.map(async (record) => {
      const pub = await fetchPublicBusinessInfo(record.b_no);

      if (!pub?.b_nm) {
        unverifiable++;
        await supabase.from('businesses').update({
          verify_status: 'needs_review',
          api_source: 'unverifiable',
          updated_at: now,
        }).eq('b_no', record.b_no);
        return;
      }

      if (normalizeName(pub.b_nm) === normalizeName(record.b_nm || '')) {
        verified++;
        await supabase.from('businesses').update({
          verify_status: 'verified',
          updated_at: now,
        }).eq('b_no', record.b_no);
        return;
      }

      needsReview++;
      await supabase.from('businesses').update({
        verify_status: 'needs_review',
        suggested_nm: pub.b_nm,
        suggested_sector: pub.b_sector ?? null,
        suggested_type: pub.b_type ?? null,
        api_source: pub.source,
        updated_at: now,
      }).eq('b_no', record.b_no);
    }));

    if (i + CONCURRENT < activeRecords.length) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  // 남은 unscanned 건수 확인
  const { count: remaining } = await supabase
    .from('businesses')
    .select('b_no', { count: 'exact', head: true })
    .eq('verify_status', 'unscanned')
    .not('b_no', 'like', 'nm_%');

  return Response.json({
    processed: typedRecords.length,
    verified,
    needsReview,
    deleted: closedBnos.length,
    unverifiable,
    hasMore: (remaining ?? 0) > 0,
  });
}
