import { fetchPublicBusinessInfo } from './publicBusinessApi';
import { getSupabase } from './supabase';
import { fetchNtsStatusMap } from './ntsStatus';

function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜|\s)/g, '').toLowerCase();
}

// 업로드된 레코드를 공공API와 대조 후 businesses.verify_status 업데이트
// - 폐업 → 삭제
// - 이름 일치 → verified
// - 이름 불일치 → needs_review + suggested_* 저장
export async function verifyAndSaveReviews(
  records: { b_no: string; b_nm: string | null }[]
): Promise<void> {
  if (records.length === 0) return;

  const supabase = getSupabase();
  const realRecords = records.filter(r => !r.b_no.startsWith('nm_'));
  if (realRecords.length === 0) return;

  // 이미 검증 완료된 건 제외
  const { data: existing } = await supabase
    .from('businesses')
    .select('b_no, verify_status')
    .in('b_no', realRecords.map(r => r.b_no))
    .eq('verify_status', 'verified');

  const verifiedNos = new Set((existing ?? []).map((r: { b_no: string }) => r.b_no));
  const toCheck = realRecords.filter(r => !verifiedNos.has(r.b_no));
  if (toCheck.length === 0) return;

  // 폐업 사업자 삭제
  const ntsMap = await fetchNtsStatusMap(toCheck.map(r => r.b_no));
  const closedBnos = toCheck.filter(r => ntsMap[r.b_no] === '03').map(r => r.b_no);
  const activeRecords = toCheck.filter(r => ntsMap[r.b_no] !== '03');

  if (closedBnos.length > 0) {
    await supabase.from('businesses').delete().in('b_no', closedBnos);
  }

  if (activeRecords.length === 0) return;

  const now = new Date().toISOString();
  const CONCURRENT = 3;

  for (let i = 0; i < activeRecords.length; i += CONCURRENT) {
    const batch = activeRecords.slice(i, i + CONCURRENT);
    await Promise.all(batch.map(async record => {
      const pub = await fetchPublicBusinessInfo(record.b_no);

      if (!pub?.b_nm) {
        await supabase.from('businesses').update({
          verify_status: 'needs_review',
          api_source: 'unverifiable',
          updated_at: now,
        }).eq('b_no', record.b_no);
        return;
      }

      if (normalizeName(pub.b_nm) === normalizeName(record.b_nm ?? '')) {
        await supabase.from('businesses').update({
          verify_status: 'verified',
          updated_at: now,
        }).eq('b_no', record.b_no);
        return;
      }

      await supabase.from('businesses').update({
        verify_status: 'needs_review',
        suggested_nm: pub.b_nm,
        suggested_sector: pub.b_sector ?? null,
        suggested_type: pub.b_type ?? null,
        api_source: pub.source,
        updated_at: now,
      }).eq('b_no', record.b_no);
    }));
  }
}
