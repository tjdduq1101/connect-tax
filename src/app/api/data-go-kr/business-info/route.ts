import { NextRequest } from 'next/server';

// ============================================================
// 공공데이터 API로 사업자 상세정보 조회 (10자리 정확 매칭 우선)
//
// [1순위 — 병렬] 금융위원회 기업기본정보 (법인)
// [1순위 — 병렬] 근로복지공단 고용/산재보험 (전체)
// [1순위 — 병렬] 공정거래위원회 (통신·방문·전화권유·후원방문·선불식할부)
// [2순위] 국민연금 가입사업장 (6자리 prefix, 1건 매칭만 사용)
// ============================================================

interface BusinessResult {
  b_nm?: string;       // 상호명
  b_sector?: string;   // 업태
  b_type?: string;     // 업종
  b_adr?: string;      // 주소
  p_nm?: string;       // 대표자
  source: string;      // 출처
}

// ── 1. 금융위원회 기업기본정보 (법인, 10자리 정확) ───────────
async function searchFsc(bno: string, apiKey: string): Promise<BusinessResult | null> {
  try {
    const url = `https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2?serviceKey=${encodeURIComponent(apiKey)}&resultType=json&bzno=${bno}&pageNo=1&numOfRows=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const json = await res.json();
    const item = json?.response?.body?.items?.item?.[0];
    if (!item || !item.corpNm) return null;

    return {
      b_nm: item.corpNm || item.enpPbanCmpyNm,
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

// ── 2. 근로복지공단 고용/산재보험 (전체, 10자리 정확) ────────
async function searchComwel(bno: string, apiKey: string): Promise<BusinessResult | null> {
  try {
    const url = `https://apis.data.go.kr/B490001/gySjbPstateInfoService/getGySjBoheomBsshItem?serviceKey=${encodeURIComponent(apiKey)}&v_saeopjaDrno=${bno}&pageNo=1&numOfRows=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const text = await res.text();
    const extract = (tag: string): string => {
      const match = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return match?.[1]?.trim() || '';
    };

    const totalCount = extract('totalCount');
    if (!totalCount || totalCount === '0') return null;

    const name = extract('saeopjangNm');
    if (!name) return null;

    return {
      b_nm: name,
      b_sector: '',
      b_type: extract('gyEopjongNm') || extract('sjEopjongNm'),
      b_adr: extract('addr'),
      source: 'comwel',
    };
  } catch {
    return null;
  }
}

// ── 3. 공정거래위원회 (통신·방문·전화권유·후원방문·선불식할부) ──
// 5개 API를 병렬로 조회하여 가장 먼저 매칭되는 결과 반환
// 모두 brno(사업자등록번호) 파라미터로 10자리 정확 매칭
interface FtcEndpoint {
  label: string;
  url: string;
  // 응답 필드 매핑 (API마다 필드명이 약간 다름)
  nameField: string;       // 상호명/법인명
  addrField: string;       // 주소
  repField: string;        // 대표자
  statusField: string;     // 영업상태
}

const FTC_ENDPOINTS: FtcEndpoint[] = [
  {
    label: '통신판매',
    url: 'https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3',
    nameField: 'bzmnNm', addrField: 'lctnRnAddr', repField: 'rprsvNm', statusField: 'operSttusCdNm',
  },
  {
    label: '방문판매',
    url: 'https://apis.data.go.kr/1130000/ClslBsDtl_2Service/getClslBsInfoDetail_2',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm', statusField: 'bsnSttusNm',
  },
  {
    label: '전화권유판매',
    url: 'https://apis.data.go.kr/1130000/TelidsalBsDtlService/getTelidsalBsInfoDetail',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm', statusField: 'bsnSttusNm',
  },
  {
    label: '후원방문판매',
    url: 'https://apis.data.go.kr/1130000/SpnsBsDtlService/getSpnsBsInfoDetail',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm', statusField: 'bsnSttusNm',
  },
  {
    label: '선불식할부거래',
    url: 'https://apis.data.go.kr/1130000/PrpyInstBsDtlService/getPrpyInstBsInfoDetail',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm', statusField: 'bsnSttusNm',
  },
];

async function searchFtcSingle(
  bno: string, apiKey: string, ep: FtcEndpoint
): Promise<BusinessResult | null> {
  try {
    const url = `${ep.url}?serviceKey=${encodeURIComponent(apiKey)}&brno=${bno}&pageNo=1&numOfRows=1&resultType=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const json = await res.json();
    const items = json?.response?.body?.items?.item;
    if (!items) return null;
    const item = Array.isArray(items) ? items[0] : items;
    if (!item) return null;

    const name = String(item[ep.nameField] || '').trim();
    if (!name) return null;

    return {
      b_nm: name,
      b_sector: ep.label,
      b_type: ep.label,
      b_adr: String(item[ep.addrField] || item.lctnAddr || '').trim(),
      p_nm: String(item[ep.repField] || '').trim(),
      source: 'ftc',
    };
  } catch {
    return null;
  }
}

async function searchFtc(bno: string, apiKey: string): Promise<BusinessResult | null> {
  const results = await Promise.all(
    FTC_ENDPOINTS.map(ep => searchFtcSingle(bno, apiKey, ep))
  );
  return results.find(r => r !== null) ?? null;
}

// ── 4. 국민연금 가입사업장 (6자리 prefix, 1건만 신뢰) ────────
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

    const active = items.filter((i: Record<string, unknown>) =>
      i['사업장가입상태코드 1 등록 2 탈퇴'] === 1
    );
    const candidates = active.length > 0 ? active : items;

    // 1건일 때만 신뢰, 여러 건이면 전체 무시
    if (candidates.length !== 1) return null;

    const match = candidates[0];
    return {
      b_nm: String(match['사업장명'] || ''),
      b_sector: '',
      b_type: String(match['사업장업종코드명'] || ''),
      b_adr: String(match['사업장도로명상세주소'] || match['사업장지번상세주소'] || ''),
      source: 'nps',
    };
  } catch {
    return null;
  }
}

// ── 라우트 핸들러 ─────────────────────────────────────────
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

  // ━━━ 1순위: 10자리 정확 매칭 API 병렬 호출 ━━━
  // 금융위원회(법인) + 근로복지공단(고용보험) + 공정거래위원회(5개) 동시 조회
  const [fscResult, comwelResult, ftcResult] = await Promise.all([
    searchFsc(cleaned, apiKey),
    searchComwel(cleaned, apiKey),
    searchFtc(cleaned, apiKey),
  ]);

  // 우선순위: 금융위원회 > 근로복지공단 > 공정거래위원회
  const primary = fscResult || comwelResult || ftcResult;

  if (primary) {
    // 다른 소스의 결과로 빈 필드 보강
    const others = [fscResult, comwelResult, ftcResult].filter(r => r && r !== primary);
    for (const other of others) {
      if (!other) continue;
      if (!primary.b_nm && other.b_nm) primary.b_nm = other.b_nm;
      if (!primary.b_type && other.b_type) primary.b_type = other.b_type;
      if (!primary.b_sector && other.b_sector) primary.b_sector = other.b_sector;
      if (!primary.b_adr && other.b_adr) primary.b_adr = other.b_adr;
      if (!primary.p_nm && other.p_nm) primary.p_nm = other.p_nm;
    }
    return Response.json({ data: primary });
  }

  // ━━━ 2순위: 국민연금 (6자리 prefix, 1건 매칭만) ━━━
  const npsResult = await searchNps(cleaned, apiKey);
  if (npsResult) {
    return Response.json({ data: npsResult });
  }

  return Response.json({ data: null });
}
