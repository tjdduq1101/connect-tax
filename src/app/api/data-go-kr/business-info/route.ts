import { NextRequest } from 'next/server';

// ============================================================
// 공공데이터 API로 사업자 상세정보 조회
// 1순위: 금융위원회 기업기본정보 (법인)
// 2순위: 국민연금 가입사업장 (사업자번호 앞 6자리 매칭)
// ============================================================

interface BusinessResult {
  b_nm?: string;       // 상호명
  b_sector?: string;   // 업태
  b_type?: string;     // 업종
  b_adr?: string;      // 주소
  p_nm?: string;       // 대표자
  source: string;      // 출처
}

// 1. 금융위원회 기업기본정보 (법인 사업자)
async function searchFsc(bno: string, apiKey: string): Promise<BusinessResult | null> {
  try {
    const url = `https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2?serviceKey=${encodeURIComponent(apiKey)}&resultType=json&bzno=${bno}&pageNo=1&numOfRows=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const json = await res.json();
    const item = json?.response?.body?.items?.item?.[0];
    if (!item || !item.corpNm) return null;

    return {
      b_nm: item.enpPbanCmpyNm || item.corpNm,
      b_sector: item.enpMainBizNm || item.sicNm || '',
      b_type: item.sicNm || '',
      b_adr: item.enpBsadr || '',
      p_nm: item.enpRprFnm || '',
      source: 'fsc',
    };
  } catch {
    return null;
  }
}

// 2. 국민연금 가입사업장 (사업자번호 앞 6자리)
async function searchNps(bno: string, apiKey: string): Promise<BusinessResult | null> {
  try {
    const prefix = bno.substring(0, 6).replace(/^0+/, '') || '0';
    const condKey = encodeURIComponent('cond[사업자등록번호::EQ]');
    const url = `https://api.odcloud.kr/api/15083277/v1/uddi:7e1553a3-6b4a-4de0-81bf-86b37ee4d61a?page=1&perPage=10&serviceKey=${encodeURIComponent(apiKey)}&${condKey}=${prefix}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const json = await res.json();
    const items = json?.data;
    if (!items || items.length === 0) return null;

    // 활성 사업장만 필터 (가입상태코드 1=등록)
    const active = items.filter((i: Record<string, unknown>) =>
      i['사업장가입상태코드 1 등록 2 탈퇴'] === 1
    );
    const candidates = active.length > 0 ? active : items;

    // 가입자수 기준 가장 큰 사업장 선택 (동일 사업자번호 앞 6자리 중 가장 유력)
    const best = candidates.reduce((a: Record<string, unknown>, b: Record<string, unknown>) =>
      ((a['가입자수'] as number) || 0) >= ((b['가입자수'] as number) || 0) ? a : b
    );

    return {
      b_nm: String(best['사업장명'] || ''),
      b_sector: '',
      b_type: String(best['사업장업종코드명'] || ''),
      b_adr: String(best['사업장도로명상세주소'] || best['사업장지번상세주소'] || ''),
      source: 'nps',
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const bno = request.nextUrl.searchParams.get('bno');
  if (!bno) {
    return Response.json({ error: 'bno 파라미터가 필요합니다.' }, { status: 400 });
  }

  const cleaned = bno.replace(/-/g, '');
  if (cleaned.length !== 10) {
    return Response.json({ error: '사업자등록번호 10자리가 필요합니다.' }, { status: 400 });
  }

  const apiKey = process.env.DATA_GO_KR_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: '공공데이터포털 API 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  // 1순위: 금융위원회 (법인 정확 매칭)
  const fscResult = await searchFsc(cleaned, apiKey);
  if (fscResult) {
    return Response.json({ data: fscResult });
  }

  // 2순위: 국민연금 (사업자번호 앞 6자리)
  const npsResult = await searchNps(cleaned, apiKey);
  if (npsResult) {
    return Response.json({ data: npsResult });
  }

  return Response.json({ data: null });
}
