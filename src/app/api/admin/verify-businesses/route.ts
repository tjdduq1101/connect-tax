import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { fetchPublicBusinessInfo } from '@/lib/publicBusinessApi';

export const maxDuration = 60;

function checkPassword(body: Record<string, unknown>): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return body.password === adminPassword;
}

interface DbRecord {
  b_no: string;
  b_nm: string | null;
}

interface FixedRecord {
  b_no: string;
  old_nm: string | null;
  new_nm: string;
}

function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜|\s)/g, '').toLowerCase();
}

// POST /api/admin/verify-businesses
// body: { offset?: number; limit?: number }
// DB를 수정하지 않고 오염 의심 목록만 반환 — 실제 반영은 /api/admin/reviews POST로 처리
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  if (!checkPassword(body)) {
    return Response.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const offset: number = typeof body.offset === 'number' ? body.offset : 0;
  const limit: number = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 50;

  const supabase = getSupabase();

  const { data: records, error } = await supabase
    .from('businesses')
    .select('b_no, b_nm')
    .not('b_no', 'like', 'nm_%')
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
    }));

    if (i + CONCURRENT < records.length) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  return Response.json({
    processed: records.length,
    fixed,
    noApiData,
    unchanged,
    hasMore: records.length === limit,
    nextOffset: offset + records.length,
  });
}
