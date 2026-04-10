import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q) return Response.json({ error: 'q 파라미터가 필요합니다.' }, { status: 400 });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return Response.json({ error: '네이버 API 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=5&sort=random`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });

    if (!res.ok) {
      return Response.json({ error: '네이버 검색 중 오류가 발생했습니다.' }, { status: res.status });
    }

    const data = await res.json();

    const items = (data.items || []).map((item: { title: string; category: string; address: string; roadAddress: string; telephone: string; description?: string; link: string }) => ({
      title: item.title.replace(/<[^>]+>/g, ''),
      category: item.category,
      address: item.address,
      roadAddress: item.roadAddress,
      telephone: item.telephone,
      description: item.description?.replace(/<[^>]+>/g, '') || '',
      link: item.link,
    }));

    return Response.json({ items });
  } catch {
    return Response.json({ error: '네이버 검색 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
