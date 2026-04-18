import { NextRequest } from 'next/server';
import { fetchPublicBusinessInfo } from '@/lib/publicBusinessApi';

export async function GET(request: NextRequest) {
  const bno = request.nextUrl.searchParams.get('bno');
  if (!bno) {
    return Response.json({ error: 'bno 파라미터가 필요합니다.' }, { status: 400 });
  }

  const cleaned = bno.replace(/-/g, '');
  if (cleaned.length !== 10) {
    return Response.json({ error: '사업자등록번호 10자리가 필요합니다.' }, { status: 400 });
  }

  if (!process.env.DATA_GO_KR_API_KEY?.trim()) {
    return Response.json({ error: '공공데이터포털 API 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  const data = await fetchPublicBusinessInfo(cleaned);
  return Response.json({ data: data ?? null });
}
