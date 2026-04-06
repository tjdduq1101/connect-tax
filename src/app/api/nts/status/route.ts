import { NextRequest } from 'next/server';
import axios from 'axios';

export async function GET(request: NextRequest) {
  const bno = request.nextUrl.searchParams.get('bno');
  if (!bno) return Response.json({ error: 'bno 파라미터가 필요합니다.' }, { status: 400 });

  const apiKey = process.env.NTS_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: 'NTS API 키가 설정되지 않았습니다.' }, { status: 503 });

  try {
    const response = await axios.post(
      `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(apiKey)}`,
      { b_no: [bno.replace(/-/g, '')] }
    );
    return Response.json({ data: response.data?.data?.[0] || null });
  } catch (err: unknown) {
    const status = axios.isAxiosError(err) ? (err.response?.status || 500) : 500;
    return Response.json({ error: '국세청 API 오류' }, { status });
  }
}
