import { fetchPublicBusinessInfo } from './publicBusinessApi';
import { getSupabase } from './supabase';
import { fetchNtsStatusMap } from './ntsStatus';

function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜|\s)/g, '').toLowerCase();
}

interface ReviewRow {
  b_no: string;
  current_nm: string | null;
  suggested_nm: string;
  suggested_sector: string | null;
  suggested_type: string | null;
  api_source: string;
  status: string;
  updated_at: string;
}

// 업로드된 레코드를 공공API와 대조:
// - 폐업 사업자: businesses + business_reviews에서 삭제
// - 이름 불일치: business_reviews에 pending으로 저장 (관리자 수동 검토 대기)
export async function verifyAndSaveReviews(
  records: { b_no: string; b_nm: string | null }[]
): Promise<void> {
  if (records.length === 0) return;

  const supabase = getSupabase();

  // 합성키 제외, 이미 승인/거부된 건 제외
  const realRecords = records.filter(r => !r.b_no.startsWith('nm_'));
  if (realRecords.length === 0) return;

  const { data: existing } = await supabase
    .from('business_reviews')
    .select('b_no')
    .in('b_no', realRecords.map(r => r.b_no))
    .in('status', ['approved', 'rejected']);

  const processedNos = new Set((existing ?? []).map((r: { b_no: string }) => r.b_no));
  const toCheck = realRecords.filter(r => !processedNos.has(r.b_no));
  if (toCheck.length === 0) return;

  // 폐업 사업자 삭제
  const ntsMap = await fetchNtsStatusMap(toCheck.map(r => r.b_no));
  const closedBnos = toCheck.filter(r => ntsMap[r.b_no] === '03').map(r => r.b_no);
  const activeRecords = toCheck.filter(r => ntsMap[r.b_no] !== '03');

  if (closedBnos.length > 0) {
    await supabase.from('business_reviews').delete().in('b_no', closedBnos);
    await supabase.from('businesses').delete().in('b_no', closedBnos);
  }

  if (activeRecords.length === 0) return;

  const corrupted: ReviewRow[] = [];
  const CONCURRENT = 3;

  for (let i = 0; i < activeRecords.length; i += CONCURRENT) {
    const batch = activeRecords.slice(i, i + CONCURRENT);
    await Promise.all(batch.map(async record => {
      const pub = await fetchPublicBusinessInfo(record.b_no);
      if (!pub?.b_nm) return;
      if (normalizeName(pub.b_nm) === normalizeName(record.b_nm ?? '')) return;

      corrupted.push({
        b_no: record.b_no,
        current_nm: record.b_nm,
        suggested_nm: pub.b_nm,
        suggested_sector: pub.b_sector ?? null,
        suggested_type: pub.b_type ?? null,
        api_source: pub.source,
        status: 'pending',
        updated_at: new Date().toISOString(),
      });
    }));
  }

  if (corrupted.length > 0) {
    await supabase
      .from('business_reviews')
      .upsert(corrupted, { onConflict: 'b_no' });
  }
}
