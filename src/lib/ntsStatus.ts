const NTS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';
const BATCH_SIZE = 100;

// b_no 배열을 NTS API에 조회해 b_no → b_stt_cd 맵 반환
// b_stt_cd: '01' 계속사업자 | '02' 휴업자 | '03' 폐업자
export async function fetchNtsStatusMap(bnos: string[]): Promise<Record<string, string>> {
  const apiKey = process.env.DATA_GO_KR_API_KEY?.trim();
  if (!apiKey || bnos.length === 0) return {};

  const map: Record<string, string> = {};

  for (let i = 0; i < bnos.length; i += BATCH_SIZE) {
    const batch = bnos.slice(i, i + BATCH_SIZE).map(b => b.replace(/-/g, ''));
    try {
      const res = await fetch(`${NTS_URL}?serviceKey=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b_no: batch }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of (data?.data ?? []) as { b_no: string; b_stt_cd?: string }[]) {
        if (item.b_no && item.b_stt_cd) map[item.b_no] = item.b_stt_cd;
      }
    } catch { /* 조회 실패 시 해당 배치 무시 */ }
  }

  return map;
}
