import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const bno = request.nextUrl.searchParams.get('bno');
  if (!bno) return Response.json({ error: 'bno 파라미터가 필요합니다.' }, { status: 400 });

  const apiKey = (process.env.DATA_GO_KR_API_KEY || process.env.NTS_API_KEY)?.trim();
  if (!apiKey) return Response.json({ error: '공공데이터포털 API 키가 설정되지 않았습니다.' }, { status: 503 });

  try {
    const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b_no: [bno.replace(/-/g, '')] }),
    });

    if (!res.ok) {
      return Response.json({ error: '국세청 API 오류' }, { status: res.status });
    }

    const data = await res.json();
    return Response.json({ data: data?.data?.[0] || null });
  } catch {
    return Response.json({ error: '국세청 API 오류' }, { status: 500 });
  }
}
