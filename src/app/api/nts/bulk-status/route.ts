import { NextRequest } from 'next/server';

const BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const bnos: string[] = (body.b_no || []).map((n: string) => n.replace(/-/g, ''));

  if (bnos.length === 0) {
    return Response.json({ error: 'b_no 배열이 필요합니다.' }, { status: 400 });
  }

  const apiKey = (process.env.DATA_GO_KR_API_KEY || process.env.NTS_API_KEY)?.trim();
  if (!apiKey) {
    return Response.json({ error: '공공데이터포털 API 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(apiKey)}`;

  try {
    const allResults: unknown[] = [];

    for (let i = 0; i < bnos.length; i += BATCH_SIZE) {
      const batch = bnos.slice(i, i + BATCH_SIZE);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b_no: batch }),
      });

      if (!res.ok) {
        return Response.json({ error: '국세청 API 오류' }, { status: res.status });
      }

      const data = await res.json();
      const items = data?.data ?? [];
allResults.push(...items);
    }

    return Response.json({ data: allResults });
  } catch {
    return Response.json({ error: '국세청 API 오류' }, { status: 500 });
  }
}
