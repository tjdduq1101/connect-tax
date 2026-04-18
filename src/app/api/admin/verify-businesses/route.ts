import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { fetchPublicBusinessInfo } from '@/lib/publicBusinessApi';

export const maxDuration = 60;

interface DbRecord {
  b_no: string;
  b_nm: string | null;
  p_nm: string | null;
  b_sector: string | null;
  b_type: string | null;
  b_adr: string | null;
}

interface FixedRecord {
  b_no: string;
  old_nm: string | null;
  new_nm: string;
}

// 상호명 정규화 — 법인격 표기 및 공백 제거 후 소문자 비교
function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜|\s)/g, '').toLowerCase();
}

// POST /api/admin/verify-businesses
// body: { offset?: number; limit?: number; dryRun?: boolean }
//
// - offset/limit으로 페이지네이션 (기본 limit=50)
// - dryRun=true 이면 DB 수정 없이 오염 의심 레코드 목록만 반환
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const offset: number = typeof body.offset === 'number' ? body.offset : 0;
  const limit: number = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 50;
  const dryRun: boolean = body.dryRun === true;

  const supabase = getSupabase();

  const { data: records, error } = await supabase
    .from('businesses')
    .select('b_no, b_nm, p_nm, b_sector, b_type, b_adr')
    .not('b_no', 'like', 'nm_%')   // 합성키(상호명 기반) 제외
    .range(offset, offset + limit - 1);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!records || records.length === 0) {
    return Response.json({ processed: 0, fixed: [], noApiData: 0, unchanged: 0, hasMore: false, nextOffset: offset });
  }

  const fixed: FixedRecord[] = [];
  let noApiData = 0;
  let unchanged = 0;

  // 3개씩 병렬 처리 (공공API rate limit 고려)
  const CONCURRENT = 3;
  for (let i = 0; i < records.length; i += CONCURRENT) {
    const batch = (records as DbRecord[]).slice(i, i + CONCURRENT);

    await Promise.all(batch.map(async (record) => {
      const publicData = await fetchPublicBusinessInfo(record.b_no);

      if (!publicData?.b_nm) {
        noApiData++;
        return;
      }

      if (normalizeName(publicData.b_nm) === normalizeName(record.b_nm || '')) {
        unchanged++;
        return;
      }

      fixed.push({ b_no: record.b_no, old_nm: record.b_nm, new_nm: publicData.b_nm });

      if (!dryRun) {
        await supabase
          .from('businesses')
          .update({
            b_nm: publicData.b_nm,
            ...(publicData.p_nm && { p_nm: publicData.p_nm }),
            ...(publicData.b_sector && { b_sector: publicData.b_sector }),
            ...(publicData.b_type && { b_type: publicData.b_type }),
            ...(publicData.b_adr && { b_adr: publicData.b_adr }),
            public_api_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('b_no', record.b_no);
      }
    }));

    // 배치 사이 대기 — 공공API rate limit 방지
    if (i + CONCURRENT < records.length) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  return Response.json({
    processed: records.length,
    fixed,
    noApiData,
    unchanged,
    dryRun,
    hasMore: records.length === limit,
    nextOffset: offset + records.length,
  });
}
