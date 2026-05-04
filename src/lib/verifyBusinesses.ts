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
// - 이름 불일치: 공공API 기준으로 businesses 자동 업데이트 (pending 없이 바로 반영)
export async function verifyAndSaveReviews(
  records: { b_no: string; b_nm: string | null }[]
): Promise<void> {
  if (records.length === 0) return;

  const supabase = getSupabase();

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

  const now = new Date().toISOString();
  const toUpdateBiz: { b_no: string; b_nm: string; b_sector: string | null; b_type: string | null; updated_at: string; public_api_synced_at: string }[] = [];
  const toUpsertReview: ReviewRow[] = [];
  const CONCURRENT = 3;

  for (let i = 0; i < activeRecords.length; i += CONCURRENT) {
    const batch = activeRecords.slice(i, i + CONCURRENT);
    await Promise.all(batch.map(async record => {
      const pub = await fetchPublicBusinessInfo(record.b_no);
      if (!pub?.b_nm) return;
      if (normalizeName(pub.b_nm) === normalizeName(record.b_nm ?? '')) return;

      toUpdateBiz.push({
        b_no: record.b_no,
        b_nm: pub.b_nm,
        b_sector: pub.b_sector ?? null,
        b_type: pub.b_type ?? null,
        updated_at: now,
        public_api_synced_at: now,
      });
      toUpsertReview.push({
        b_no: record.b_no,
        current_nm: record.b_nm,
        suggested_nm: pub.b_nm,
        suggested_sector: pub.b_sector ?? null,
        suggested_type: pub.b_type ?? null,
        api_source: pub.source,
        status: 'approved',
        updated_at: now,
      });
    }));
  }

  if (toUpdateBiz.length > 0) {
    await supabase
      .from('businesses')
      .upsert(toUpdateBiz, { onConflict: 'b_no' });
  }
  if (toUpsertReview.length > 0) {
    await supabase
      .from('business_reviews')
      .upsert(toUpsertReview, { onConflict: 'b_no' });
  }
}
