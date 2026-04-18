// 공공데이터 사업자정보 조회 — 여러 소스를 우선순위대로 조합
//
// [1순위 — 병렬] 금융위원회 기업기본정보 (법인)
// [1순위 — 병렬] 근로복지공단 고용/산재보험 (전체)
// [1순위 — 병렬] 공정거래위원회 (통신·방문·전화권유·후원방문·선불식할부)
// [2순위] 국민연금 가입사업장 (10자리 정확 매칭, 1건 매칭만 사용)

export interface PublicBusinessResult {
  b_nm?: string;
  b_sector?: string;
  b_type?: string;
  b_adr?: string;
  p_nm?: string;
  source: string;
}

// ── 1. 금융위원회 기업기본정보 (법인, 10자리 정확) ───────────
async function searchFsc(bno: string, apiKey: string): Promise<PublicBusinessResult | null> {
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
async function searchComwel(bno: string, apiKey: string): Promise<PublicBusinessResult | null> {
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
interface FtcEndpoint {
  label: string;
  url: string;
  nameField: string;
  addrField: string;
  repField: string;
}

const FTC_ENDPOINTS: FtcEndpoint[] = [
  {
    label: '통신판매',
    url: 'https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3',
    nameField: 'bzmnNm', addrField: 'lctnRnAddr', repField: 'rprsvNm',
  },
  {
    label: '방문판매',
    url: 'https://apis.data.go.kr/1130000/ClslBsDtl_2Service/getClslBsInfoDetail_2',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm',
  },
  {
    label: '전화권유판매',
    url: 'https://apis.data.go.kr/1130000/TelidsalBsDtlService/getTelidsalBsInfoDetail',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm',
  },
  {
    label: '후원방문판매',
    url: 'https://apis.data.go.kr/1130000/SpnsBsDtlService/getSpnsBsInfoDetail',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm',
  },
  {
    label: '선불식할부거래',
    url: 'https://apis.data.go.kr/1130000/PrpyInstBsDtlService/getPrpyInstBsInfoDetail',
    nameField: 'conmNm', addrField: 'rnAddr', repField: 'rprsvNm',
  },
];

async function searchFtcSingle(bno: string, apiKey: string, ep: FtcEndpoint): Promise<PublicBusinessResult | null> {
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

async function searchFtc(bno: string, apiKey: string): Promise<PublicBusinessResult | null> {
  const results = await Promise.all(FTC_ENDPOINTS.map(ep => searchFtcSingle(bno, apiKey, ep)));
  return results.find(r => r !== null) ?? null;
}

// ── 4. 국민연금 가입사업장 (10자리 정확 매칭, 1건만 신뢰) ────────
async function searchNps(bno: string, apiKey: string): Promise<PublicBusinessResult | null> {
  try {
    const condKey = encodeURIComponent('cond[사업자등록번호::EQ]');
    const url = `https://api.odcloud.kr/api/15083277/v1/uddi:7e1553a3-6b4a-4de0-81bf-86b37ee4d61a?page=1&perPage=1&serviceKey=${encodeURIComponent(apiKey)}&${condKey}=${bno}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const json = await res.json();
    const items = json?.data;
    if (!items || items.length === 0) return null;

    const active = items.filter((i: Record<string, unknown>) =>
      i['사업장가입상태코드 1 등록 2 탈퇴'] === 1
    );
    const candidates = active.length > 0 ? active : items;

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

// ── 메인 조회 함수 ─────────────────────────────────────────
export async function fetchPublicBusinessInfo(bno: string): Promise<PublicBusinessResult | null> {
  const apiKey = process.env.DATA_GO_KR_API_KEY?.trim();
  if (!apiKey) return null;

  const cleaned = bno.replace(/-/g, '');

  const [fscResult, comwelResult, ftcResult] = await Promise.all([
    searchFsc(cleaned, apiKey),
    searchComwel(cleaned, apiKey),
    searchFtc(cleaned, apiKey),
  ]);

  const primary = fscResult || comwelResult || ftcResult;

  if (primary) {
    const others = [fscResult, comwelResult, ftcResult].filter(r => r && r !== primary);
    for (const other of others) {
      if (!other) continue;
      if (!primary.b_nm && other.b_nm) primary.b_nm = other.b_nm;
      if (!primary.b_type && other.b_type) primary.b_type = other.b_type;
      if (!primary.b_sector && other.b_sector) primary.b_sector = other.b_sector;
      if (!primary.b_adr && other.b_adr) primary.b_adr = other.b_adr;
      if (!primary.p_nm && other.p_nm) primary.p_nm = other.p_nm;
    }
    return primary;
  }

  return searchNps(cleaned, apiKey);
}
