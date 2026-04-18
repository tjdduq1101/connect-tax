import { NextRequest, after } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyAndSaveReviews } from '@/lib/verifyBusinesses';

interface BusinessEntry {
  b_no: string;
  b_nm?: string;
  p_nm?: string;
  b_sector?: string;
  b_type?: string;
}

async function searchNaverName(name: string): Promise<boolean> {
  if (!name) return false;
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  try {
    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(name)}&display=1`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.items || []).length > 0;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const businesses: BusinessEntry[] = body.businesses;

    if (!Array.isArray(businesses) || businesses.length === 0) {
      return Response.json({ error: 'businesses 배열이 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabase();

    const bnos = businesses.map((b) => b.b_no);
    const { data: existing } = await supabase
      .from('businesses')
      .select('b_no, b_nm')
      .in('b_no', bnos);

    const existingMap: Record<string, string> = {};
    for (const row of existing || []) {
      existingMap[row.b_no] = row.b_nm;
    }

    // 배치 처리: 5개씩 순차 실행하여 네이버 API rate limit 방지
    const BATCH_SIZE = 5;
    const rows: { b_no: string; b_nm: string | null; p_nm: string | null; b_sector: string | null; b_type: string | null; updated_at: string; public_api_synced_at: null }[] = [];

    for (let i = 0; i < businesses.length; i += BATCH_SIZE) {
      const batch = businesses.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (b) => {
          const row = {
            b_no: b.b_no,
            b_nm: b.b_nm || null,
            p_nm: b.p_nm || null,
            b_sector: b.b_sector || null,
            b_type: b.b_type || null,
            updated_at: new Date().toISOString(),
            public_api_synced_at: null,
          };

          // 합성키(상호명 기반)는 네이버 충돌 검사 불필요
          const isSyntheticKey = b.b_no.startsWith("nm_");
          if (!isSyntheticKey) {
            const existingName = existingMap[b.b_no];
            const newName = b.b_nm;

            if (existingName && newName && existingName !== newName) {
              const [newHit, existingHit] = await Promise.all([
                searchNaverName(newName),
                searchNaverName(existingName),
              ]);
              if (existingHit && !newHit) {
                row.b_nm = existingName;
              }
            }
          }

          return row;
        })
      );
      rows.push(...batchResults);
    }

    const { error } = await supabase
      .from('businesses')
      .upsert(rows, { onConflict: 'b_no' });

    if (error) throw error;

    // 응답 후 백그라운드에서 공공API 대조 검증
    after(() => verifyAndSaveReviews(rows.map(r => ({ b_no: r.b_no, b_nm: r.b_nm }))));

    return Response.json({ success: true, count: rows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
