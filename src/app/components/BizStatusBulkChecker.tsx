"use client";
import { useState } from 'react';

// ============================================================
// Types
// ============================================================
interface BizEntry {
  name: string;
  bno: string; // 10자리 숫자
}

interface StatusResult {
  b_no: string;
  b_stt_cd?: string;
  b_stt?: string;
  tax_type_cd?: string;
  tax_type?: string;
  end_dt?: string;          // 폐업일 / 휴업일 (YYYYMMDD)
  tax_type_chg_dt?: string; // 최근 과세유형 전환일 (YYYYMMDD)
  invoice_apply_dt?: string;// 세금계산서 발급 적용일 (YYYYMMDD)
  // 입력 정보
  inputName?: string;
}

// ============================================================
// Utilities
// ============================================================
function getStatusInfo(code?: string) {
  if (code === '01') return { label: '계속사업자', bg: '#E8F5E9', color: '#2E7D32' };
  if (code === '02') return { label: '휴업자',     bg: '#FFF3E0', color: '#E65100' };
  if (code === '03') return { label: '폐업자',     bg: '#FFEBEE', color: '#C62828' };
  return { label: '조회불가', bg: '#F5F5F5', color: '#9E9E9E' };
}

function getTaxTypeInfo(code?: string, text?: string) {
  // 코드 우선, 없으면 텍스트로 판별
  const key = code || (text?.includes('간이') ? '02' : text?.includes('면세') ? '03' : text?.includes('비영리') ? '04' : text ? '01' : undefined);
  if (key === '01') return { label: '일반과세자', bg: '#DBEAFE', color: '#1D4ED8' };
  if (key === '02') return { label: '간이과세자', bg: '#FEF9C3', color: '#A16207' };
  if (key === '03') return { label: '면세사업자', bg: '#F3F4F6', color: '#374151' };
  if (key === '04') return { label: '비영리법인', bg: '#F3F4F6', color: '#374151' };
  return null;
}

function formatBizNo(raw: string) {
  const d = raw.replace(/[^0-9]/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function formatDate(dt?: string) {
  if (!dt || dt.length !== 8) return null;
  return `${dt.slice(0, 4)}.${dt.slice(4, 6)}.${dt.slice(6)}`;
}

// 세금계산서 발급 가능 여부: invoice_apply_dt가 있거나 tax_type 텍스트에 '세금계산서' 포함
function isInvoiceIssuer(r: StatusResult) {
  return !!(r.invoice_apply_dt || r.tax_type?.includes('세금계산서'));
}

/**
 * 엑셀에서 복사한 텍스트 파싱
 * - 탭으로 구분된 셀, 줄바꿈으로 구분된 행
 * - 각 행에서 10자리 숫자를 사업자번호로, 나머지를 사업장명으로 인식
 */
function parsePastedText(text: string): BizEntry[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const entries: BizEntry[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const cells = line.split('\t').map(c => c.trim()).filter(c => c);
    let bno = '';
    let name = '';

    for (const cell of cells) {
      const digits = cell.replace(/[^0-9]/g, '');
      if (digits.length === 10 && !bno) {
        bno = digits;
      }
    }
    if (!bno) continue;

    // bno가 아닌 첫 번째 셀을 사업장명으로
    for (const cell of cells) {
      const digits = cell.replace(/[^0-9]/g, '');
      if (digits !== bno) {
        name = cell;
        break;
      }
    }

    if (seen.has(bno)) continue;
    seen.add(bno);
    entries.push({ name, bno });
  }
  return entries;
}

async function fetchBulkStatus(bnos: string[]): Promise<StatusResult[]> {
  const res = await fetch('/api/nts/bulk-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ b_no: bnos }),
  });
  if (!res.ok) throw new Error('국세청 API 조회 실패');
  const json = await res.json();
  return (json.data || []) as StatusResult[];
}

// ============================================================
// Component
// ============================================================
export default function BizStatusBulkChecker({ onBack }: { onBack: () => void }) {
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<BizEntry[]>([]);
  const [results, setResults] = useState<StatusResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setPasteText(text);
    const entries = parsePastedText(text);
    setParsed(entries);
    setResults([]);
    setError('');
  };

  const handleCheck = async () => {
    if (parsed.length === 0) { setError('사업자번호를 입력해주세요.'); return; }
    setLoading(true); setError(''); setResults([]); setProgress(0);

    try {
      const BATCH = 100;
      const nameMap = new Map(parsed.map(e => [e.bno, e.name]));
      const allResults: StatusResult[] = [];

      for (let i = 0; i < parsed.length; i += BATCH) {
        const batch = parsed.slice(i, i + BATCH).map(e => e.bno);
        const batchResults = await fetchBulkStatus(batch);
        for (const r of batchResults) {
          r.inputName = nameMap.get(r.b_no.replace(/-/g, '')) || '';
        }
        allResults.push(...batchResults);
        setProgress(Math.min(100, Math.round(((i + BATCH) / parsed.length) * 100)));
      }

      // 입력 순서 유지, 조회 실패 항목도 포함
      const resultMap = new Map(allResults.map(r => [r.b_no.replace(/-/g, ''), r]));
      const ordered = parsed.map(e => {
        const r = resultMap.get(e.bno);
        if (r) return r;
        return { b_no: e.bno, inputName: e.name } as StatusResult;
      });
      setResults(ordered);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  };

const activeCount    = results.filter(r => r.b_stt_cd === '01').length;
  const suspendedCount = results.filter(r => r.b_stt_cd === '02').length;
  const closedCount    = results.filter(r => r.b_stt_cd === '03').length;
  const unknownCount   = results.filter(r => !r.b_stt_cd).length;

  return (
    <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={onBack}
        className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors"
      >
        &#8592; 돌아가기
      </button>

      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-violet-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">사업자상태 대량조회</h1>
          <p className="text-violet-100 text-xs font-bold uppercase tracking-widest opacity-80">
            Business Status Bulk Check
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* Input */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-1">
              엑셀에서 사업장명 + 사업자번호 열을 선택하여 복사 후 붙여넣기
            </label>
            <textarea
              className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-purple-400 transition-all resize-none"
              rows={7}
              placeholder={
                '사업장명\t사업자번호\n' +
                '삼성전자\t124-81-00998\n' +
                '네이버\t220-81-04521\n\n' +
                '※ 엑셀에서 두 열을 드래그 → Ctrl+C → 여기에 Ctrl+V\n' +
                '※ 사업자번호만 복사해도 됩니다.'
              }
              value={pasteText}
              onChange={handleTextChange}
            />
            {parsed.length > 0 && (
              <p className="text-xs font-bold text-purple-600 mt-1.5 ml-1">
                ✓ {parsed.length}개 사업자번호 인식됨
                {parsed.filter(e => e.name).length > 0 &&
                  ` (사업장명 ${parsed.filter(e => e.name).length}개 포함)`}
              </p>
            )}
          </div>

          {error && <p className="text-red-500 text-xs font-bold">⚠️ {error}</p>}

          <button
            onClick={handleCheck}
            disabled={loading || parsed.length === 0}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-xl font-black text-sm shadow-lg transition-all active:scale-95"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                조회 중... {progress > 0 ? `${progress}%` : ''}
              </span>
            ) : (
              parsed.length > 0
                ? `${parsed.length}개 사업자상태 조회`
                : '사업자상태 조회'
            )}
          </button>

          {/* Results */}
          {results.length > 0 && (
            <div className="animate-in fade-in duration-300 space-y-4">
              {/* Summary chips */}
              <div className="flex gap-2 flex-wrap items-center">
                <span className="bg-green-50 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                  계속 {activeCount}개
                </span>
                <span className="bg-orange-50 text-orange-700 text-xs font-bold px-3 py-1 rounded-full">
                  휴업 {suspendedCount}개
                </span>
                <span className="bg-red-50 text-red-700 text-xs font-bold px-3 py-1 rounded-full">
                  폐업 {closedCount}개
                </span>
                {unknownCount > 0 && (
                  <span className="bg-slate-100 text-slate-500 text-xs font-bold px-3 py-1 rounded-full">
                    조회불가 {unknownCount}개
                  </span>
                )}
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">번호</th>
                      <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">사업장명</th>
                      <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">사업자번호</th>
                      <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">사업자상태</th>
                      <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">과세유형</th>
                      <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">폐업(휴업)일자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const status = getStatusInfo(r.b_stt_cd);
                      const showEndDate = r.b_stt_cd === '02' || r.b_stt_cd === '03';
                      const taxInfo = getTaxTypeInfo(r.tax_type_cd, r.tax_type);
                      const isSimple = taxInfo?.label === '간이과세자';
                      const invoiceIssuer = isSimple && isInvoiceIssuer(r);
                      const chgDate = isSimple ? formatDate(r.tax_type_chg_dt) : null;
                      return (
                        <tr
                          key={i}
                          className="border-t border-slate-50 hover:bg-slate-50 transition-colors"
                          style={showEndDate ? { background: `${status.bg}60` } : undefined}
                        >
                          <td className="p-3 text-[10px] font-bold text-slate-300">{i + 1}</td>
                          <td className="p-3 text-xs font-bold text-slate-700">{r.inputName || '-'}</td>
                          <td className="p-3 text-xs font-mono font-bold text-slate-600">{formatBizNo(r.b_no)}</td>
                          <td className="p-3">
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                              style={{ background: status.bg, color: status.color }}
                            >
                              {status.label}
                            </span>
                          </td>
                          <td className="p-3">
                            {taxInfo ? (
                              <div className="flex flex-col gap-0.5">
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap self-start"
                                  style={{ background: taxInfo.bg, color: taxInfo.color }}
                                >
                                  {taxInfo.label}
                                </span>
                                {invoiceIssuer && (
                                  <span className="text-[10px] font-bold text-slate-400 pl-0.5">
                                    세금계산서 발급사업자
                                  </span>
                                )}
                                {chgDate && (
                                  <span className="text-[10px] font-bold text-slate-300 pl-0.5">
                                    전환일 {chgDate}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-slate-300">-</span>
                            )}
                          </td>
                          <td className="p-3 text-xs font-bold" style={{ color: showEndDate ? status.color : '#9CA3AF' }}>
                            {showEndDate ? (formatDate(r.end_dt) ?? '-') : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
