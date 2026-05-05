// DB 오염 데이터 자동 검증 스크립트
// 로컬: node --env-file=.env.local scripts/verify-db.mjs
// GitHub Actions: 환경변수 직접 주입
//
// businesses.verify_status = 'unscanned' 인 레코드를 공공API와 대조
// - 폐업 → 삭제
// - 이름 일치 → verified
// - 이름 불일치 → needs_review + suggested_* 저장
// - API 조회 불가 → needs_review (api_source='unverifiable')

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = process.env.DATA_GO_KR_API_KEY?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_KEY) {
  console.error('환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATA_GO_KR_API_KEY 필요');
  process.exit(1);
}

const RUN_LIMIT = 1000;
const CONCURRENT = 10;
const BATCH_SIZE = 100;
const NTS_BATCH = 100;

const SB_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Supabase helpers ───────────────────────────────────────────
async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH 오류 ${res.status}: ${path}`);
}

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`Supabase DELETE 오류 ${res.status}: ${path}`);
}

async function fetchUnscanned(limit) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/businesses?select=b_no,b_nm&verify_status=eq.unscanned&b_no=not.like.nm_%25&limit=${limit}`,
    { headers: SB_HEADERS }
  );
  if (!res.ok) throw new Error(`Supabase 조회 오류 ${res.status}`);
  return res.json();
}

async function countUnscanned() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/businesses?select=b_no&verify_status=eq.unscanned&b_no=not.like.nm_%25`,
    { headers: { ...SB_HEADERS, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }
  );
  return parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10);
}

// ── NTS 폐업 조회 ─────────────────────────────────────────────
async function fetchNtsStatusMap(bnos) {
  const map = {};
  for (let i = 0; i < bnos.length; i += NTS_BATCH) {
    const batch = bnos.slice(i, i + NTS_BATCH).map(b => b.replace(/-/g, ''));
    try {
      const res = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b_no: batch }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of (data?.data ?? [])) {
        if (item.b_no && item.b_stt_cd) map[item.b_no] = item.b_stt_cd;
      }
    } catch { /* 배치 실패 시 무시 */ }
  }
  return map;
}

// ── 공공API ────────────────────────────────────────────────────
function normalizeName(name) {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜|\s)/g, '').toLowerCase();
}

async function searchFsc(bno) {
  try {
    const url = `https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2?serviceKey=${encodeURIComponent(API_KEY)}&resultType=json&bzno=${bno}&pageNo=1&numOfRows=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json();
    const item = json?.response?.body?.items?.item?.[0];
    if (!item?.corpNm) return null;
    return { b_nm: item.corpNm, b_sector: item.enpMainBizNm || '', b_type: item.sicNm || '', source: 'fsc' };
  } catch { return null; }
}

async function searchComwel(bno) {
  try {
    const url = `https://apis.data.go.kr/B490001/gySjbPstateInfoService/getGySjBoheomBsshItem?serviceKey=${encodeURIComponent(API_KEY)}&v_saeopjaDrno=${bno}&pageNo=1&numOfRows=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    const extract = tag => text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() || '';
    if (!extract('totalCount') || extract('totalCount') === '0') return null;
    const name = extract('saeopjangNm');
    if (!name) return null;
    return { b_nm: name, b_sector: '', b_type: extract('gyEopjongNm') || extract('sjEopjongNm'), source: 'comwel' };
  } catch { return null; }
}

const FTC_ENDPOINTS = [
  { url: 'https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3', nameField: 'bzmnNm', label: '통신판매' },
  { url: 'https://apis.data.go.kr/1130000/ClslBsDtl_2Service/getClslBsInfoDetail_2', nameField: 'conmNm', label: '방문판매' },
  { url: 'https://apis.data.go.kr/1130000/TelidsalBsDtlService/getTelidsalBsInfoDetail', nameField: 'conmNm', label: '전화권유판매' },
  { url: 'https://apis.data.go.kr/1130000/SpnsBsDtlService/getSpnsBsInfoDetail', nameField: 'conmNm', label: '후원방문판매' },
  { url: 'https://apis.data.go.kr/1130000/PrpyInstBsDtlService/getPrpyInstBsInfoDetail', nameField: 'conmNm', label: '선불식할부' },
];

async function searchFtc(bno) {
  const results = await Promise.all(FTC_ENDPOINTS.map(async ep => {
    try {
      const url = `${ep.url}?serviceKey=${encodeURIComponent(API_KEY)}&brno=${bno}&pageNo=1&numOfRows=1&resultType=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const json = await res.json();
      const items = json?.response?.body?.items?.item;
      if (!items) return null;
      const item = Array.isArray(items) ? items[0] : items;
      const name = String(item?.[ep.nameField] || '').trim();
      return name ? { b_nm: name, b_sector: ep.label, b_type: ep.label, source: 'ftc' } : null;
    } catch { return null; }
  }));
  return results.find(r => r !== null) ?? null;
}

async function searchNps(bno) {
  try {
    const condKey = encodeURIComponent('cond[사업자등록번호::EQ]');
    const url = `https://api.odcloud.kr/api/15083277/v1/uddi:7e1553a3-6b4a-4de0-81bf-86b37ee4d61a?page=1&perPage=1&serviceKey=${encodeURIComponent(API_KEY)}&${condKey}=${bno}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data;
    if (!items?.length) return null;
    const active = items.filter(i => i['사업장가입상태코드 1 등록 2 탈퇴'] === 1);
    const candidates = active.length > 0 ? active : items;
    if (candidates.length !== 1) return null;
    const name = String(candidates[0]['사업장명'] || '');
    return name ? { b_nm: name, b_sector: '', b_type: String(candidates[0]['사업장업종코드명'] || ''), source: 'nps' } : null;
  } catch { return null; }
}

async function fetchPublicInfo(bno) {
  const [fsc, comwel, ftc] = await Promise.all([searchFsc(bno), searchComwel(bno), searchFtc(bno)]);
  return fsc || comwel || ftc || await searchNps(bno);
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  const totalUnscanned = await countUnscanned();
  const toProcess = Math.min(RUN_LIMIT, totalUnscanned);
  console.log(`\n미검사: ${totalUnscanned}건 | 이번 회차: ${toProcess}건 처리 예정`);
  console.log('─'.repeat(50));

  if (toProcess === 0) {
    console.log('검사할 레코드 없음 — 종료');
    return;
  }

  const records = await fetchUnscanned(toProcess);
  if (!records.length) { console.log('레코드 없음 — 종료'); return; }

  // 1단계: NTS 폐업 조회 → 폐업 삭제
  const allBnos = records.map(r => r.b_no);
  const ntsMap = await fetchNtsStatusMap(allBnos);
  const closedBnos = records.filter(r => ntsMap[r.b_no] === '03').map(r => r.b_no);
  const activeRecords = records.filter(r => ntsMap[r.b_no] !== '03');

  if (closedBnos.length > 0) {
    // Supabase REST API IN 필터: b_no=in.(val1,val2,...)
    const inFilter = `b_no=in.(${closedBnos.map(b => `"${b}"`).join(',')})`;
    await sbDelete(`/businesses?${inFilter}`);
    console.log(`폐업 삭제: ${closedBnos.length}건`);
  }

  // 2단계: 공공API 대조
  let verified = 0, needsReview = 0, unverifiable = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < activeRecords.length; i += CONCURRENT) {
    const batch = activeRecords.slice(i, i + CONCURRENT);
    await Promise.all(batch.map(async record => {
      const pub = await fetchPublicInfo(record.b_no);

      if (!pub?.b_nm) {
        unverifiable++;
        await sbPatch(`/businesses?b_no=eq.${record.b_no}`, {
          verify_status: 'needs_review',
          api_source: 'unverifiable',
          updated_at: now,
        });
        return;
      }

      if (normalizeName(pub.b_nm) === normalizeName(record.b_nm || '')) {
        verified++;
        await sbPatch(`/businesses?b_no=eq.${record.b_no}`, {
          verify_status: 'verified',
          updated_at: now,
        });
        return;
      }

      needsReview++;
      await sbPatch(`/businesses?b_no=eq.${record.b_no}`, {
        verify_status: 'needs_review',
        suggested_nm: pub.b_nm,
        suggested_sector: pub.b_sector || null,
        suggested_type: pub.b_type || null,
        api_source: pub.source,
        updated_at: now,
      });
    }));

    if (i + CONCURRENT < activeRecords.length) await new Promise(r => setTimeout(r, 100));
    const done = Math.min(i + CONCURRENT, activeRecords.length);
    process.stdout.write(`\r처리 중: ${done}/${activeRecords.length}건 (이상없음: ${verified} | 확인필요: ${needsReview} | 검증불가: ${unverifiable})`);
  }

  console.log(`\n\n${'─'.repeat(50)}`);
  console.log(`처리: ${activeRecords.length}건 | 폐업삭제: ${closedBnos.length}건 | 이상없음: ${verified}건 | 확인필요: ${needsReview}건 | 검증불가: ${unverifiable}건`);
  const remaining = totalUnscanned - records.length;
  console.log(remaining > 0 ? `남은 미검사: ${remaining}건` : '전체 검사 완료');
}

main().catch(err => { console.error(err); process.exit(1); });
