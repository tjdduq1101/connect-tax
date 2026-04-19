// DB 오염 데이터 자동 검증 스크립트
// 로컬: node --env-file=.env.local scripts/verify-db.mjs
// GitHub Actions: 환경변수 직접 주입

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = process.env.DATA_GO_KR_API_KEY?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_KEY) {
  console.error('환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATA_GO_KR_API_KEY 필요');
  process.exit(1);
}

const RUN_LIMIT = 1000;   // 1회 실행당 처리 건수 (하루 8회 → 일 8000건)
const CONCURRENT = 10;
const BATCH_SIZE = 100;

const SB_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Supabase helpers ───────────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`Supabase GET 오류 ${res.status}: ${path}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH 오류 ${res.status}: ${path}`);
}

async function sbUpsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert 오류 ${res.status}: ${text}`);
  }
}

async function countDbRecords() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=b_no&b_no=not.like.nm_%25`, {
    headers: { ...SB_HEADERS, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  return parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10);
}

async function fetchDbRecords(offset, limit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=b_no,b_nm&b_no=not.like.nm_%25`, {
    headers: { ...SB_HEADERS, 'Range-Unit': 'items', Range: `${offset}-${offset + limit - 1}` },
  });
  if (!res.ok) throw new Error(`Supabase range 오류 ${res.status}`);
  return res.json();
}

// 이미 승인/거부된 b_no 목록 조회 (재등록 방지)
async function fetchProcessedNos() {
  const rows = await sbGet("/business_reviews?select=b_no&status=in.(approved,rejected)");
  return new Set(rows.map(r => r.b_no));
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
  // 진행 상태 로드
  const [progressRows] = await sbGet('/verify_progress?id=eq.1');
  const startOffset = progressRows?.current_offset ?? 0;
  const total = await countDbRecords();
  const endOffset = Math.min(startOffset + RUN_LIMIT, total);

  console.log(`\n전체: ${total}건 | 이번 회차 범위: ${startOffset} ~ ${endOffset - 1}건`);
  console.log('─'.repeat(50));

  // 이미 처리된 b_no 로드 (재등록 방지)
  const processedNos = await fetchProcessedNos();

  let totalCorrupted = 0;
  let processed = 0;
  let noApiData = 0;
  let unchanged = 0;
  let offset = startOffset;
  let totalScanned = progressRows?.total_scanned ?? 0;

  while (offset < endOffset) {
    const batchLimit = Math.min(BATCH_SIZE, endOffset - offset);
    const records = await fetchDbRecords(offset, batchLimit);
    if (!records.length) break;

    const batchCorrupted = [];

    for (let i = 0; i < records.length; i += CONCURRENT) {
      const batch = records.slice(i, i + CONCURRENT);
      await Promise.all(batch.map(async record => {
        if (processedNos.has(record.b_no)) { unchanged++; return; }
        const pub = await fetchPublicInfo(record.b_no);
        if (!pub?.b_nm) { noApiData++; return; }
        if (normalizeName(pub.b_nm) === normalizeName(record.b_nm || '')) { unchanged++; return; }
        batchCorrupted.push({
          b_no: record.b_no,
          current_nm: record.b_nm,
          suggested_nm: pub.b_nm,
          suggested_sector: pub.b_sector || null,
          suggested_type: pub.b_type || null,
          api_source: pub.source,
          status: 'pending',
          updated_at: new Date().toISOString(),
        });
      }));
      if (i + CONCURRENT < records.length) await new Promise(r => setTimeout(r, 100));
    }

    processed += records.length;
    offset += BATCH_SIZE;
    totalScanned += records.length;

    // 중간 저장 — 이 배치의 오염 의심을 즉시 Supabase에 반영
    if (batchCorrupted.length > 0) {
      await sbUpsert('business_reviews', batchCorrupted);
      totalCorrupted += batchCorrupted.length;
    }

    // 진행 상태 즉시 갱신 — 중도 종료 시 다음 회차가 이어받도록
    const intermediateOffset = offset >= total ? 0 : offset;
    await sbPatch('/verify_progress?id=eq.1', {
      current_offset: intermediateOffset,
      last_run_at: new Date().toISOString(),
      total_scanned: totalScanned,
    });

    process.stdout.write(`\r처리 중: ${startOffset + processed}/${total}건 (오염 의심: ${totalCorrupted}건)`);
  }

  console.log(`\n\n${'─'.repeat(50)}`);
  console.log(`처리: ${processed}건 | 이상없음: ${unchanged}건 | 검증불가: ${noApiData}건 | 오염의심: ${totalCorrupted}건`);
  const nextOffset = offset >= total ? 0 : offset;
  console.log(nextOffset === 0 ? '전체 스캔 완료 → 다음 회차부터 처음부터 재시작' : `다음 회차 시작 위치: ${nextOffset}번`);
}

main().catch(err => { console.error(err); process.exit(1); });
