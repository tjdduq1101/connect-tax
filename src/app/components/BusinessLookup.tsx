"use client";
import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  classifyBusiness as classifyBusinessText,
  getAccountSuggestion as getAccountSuggestionText,
  type CategoryInfo,
  type AccountSuggestion,
} from '@/lib/accountClassifier';

// ============================================================
// Types
// ============================================================
interface BusinessData {
  b_no: string;
  b_nm?: string;
  p_nm?: string;
  b_sector?: string;
  b_type?: string;
  b_stt_cd?: string;
  tax_type_cd?: string;
  b_adr?: string;
  start_dt?: string;
}

interface NaverResult {
  title: string;
  category: string;
  address: string;
  roadAddress: string;
  telephone: string;
  description: string;
  link: string;
}

// ============================================================
// Utilities — classify (delegated to @/lib/accountClassifier)
// ============================================================
function classifyBusinessLocal(data: BusinessData, naverCategory?: string): CategoryInfo {
  const text = [data.b_nm, data.b_type, data.b_sector, naverCategory].filter(Boolean).join(' ');
  return classifyBusinessText(text);
}

function getAccountSuggestionLocal(data: BusinessData, categoryLabel: string): AccountSuggestion | null {
  const text = [data.b_nm, data.b_type, data.b_sector].filter(Boolean).join(' ');
  return getAccountSuggestionText(text, categoryLabel);
}

function getStatusInfo(code?: string) {
  if (code === '01') return { label: '계속사업자', bg: '#E8F5E9', color: '#2E7D32' };
  if (code === '02') return { label: '휴업자', bg: '#FFF3E0', color: '#E65100' };
  if (code === '03') return { label: '폐업자', bg: '#FFEBEE', color: '#C62828' };
  return { label: '알 수 없음', bg: '#F5F5F5', color: '#757575' };
}

function getTaxTypeLabel(code?: string) {
  if (code === '01') return '일반과세자';
  if (code === '02') return '간이과세자';
  if (code === '03') return '면세사업자';
  if (code === '04') return '비영리법인';
  return '';
}

// ============================================================
// Utilities — formatting
// ============================================================
function formatBizNo(raw: string) {
  const d = raw.replace(/[^0-9]/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function formatDate(dt?: string) {
  if (!dt || dt.length !== 8) return dt || '';
  return `${dt.slice(0, 4)}년 ${dt.slice(4, 6)}월 ${dt.slice(6)}일`;
}

// ============================================================
// Utilities — API calls
// ============================================================
async function searchServerDb(bno: string): Promise<BusinessData | null> {
  const cleaned = bno.replace(/-/g, '');
  const res = await fetch(`/api/db/search?bno=${encodeURIComponent(cleaned)}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || null;
}

async function fetchBusinessStatus(bno: string): Promise<BusinessData | null> {
  const cleaned = bno.replace(/-/g, '');
  const res = await fetch(`/api/nts/status?bno=${encodeURIComponent(cleaned)}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || null;
}

function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|\(|\)|\s)/g, '').toLowerCase();
}

function isNameMatch(title: string, query: string): boolean {
  const t = normalizeName(title);
  const q = normalizeName(query);
  return t === q || t.startsWith(q) || q.startsWith(t);
}

async function searchNaver(name: string): Promise<NaverResult[]> {
  const cleaned = name.replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|\(|\))/g, '').trim();
  if (!cleaned) return [];
  const res = await fetch(`/api/naver/search?q=${encodeURIComponent(cleaned)}`);
  if (!res.ok) return [];
  const json = await res.json();
  const items: NaverResult[] = json.items || [];
  if (items.length === 0) return [];

  // 1순위: 첫 번째 결과는 네이버 랭킹 신뢰 (항상 포함)
  const result: NaverResult[] = [items[0]];
  // 2~5번째: 상호명 일치하는 것만 추가
  for (let i = 1; i < items.length; i++) {
    if (isNameMatch(items[i].title, cleaned)) {
      result.push(items[i]);
    }
  }
  return result.slice(0, 2);
}

async function uploadToServerDb(businesses: BusinessData[]) {
  const res = await fetch('/api/db/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businesses }),
  });
  if (!res.ok) throw new Error('업로드 실패');
  return res.json();
}

async function getServerDbStats(): Promise<{ count: number }> {
  const res = await fetch('/api/db/stats');
  if (!res.ok) return { count: 0 };
  return res.json();
}

// ============================================================
// Utilities — Excel parser
// ============================================================
function parseBusinessExcel(file: File): Promise<BusinessData[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (rows.length === 0) return resolve([]);

        const cols = Object.keys(rows[0] || {});
        const map: Record<string, BusinessData> = {};

        for (const r of rows) {
          let bno = '';
          let nm = '';
          let sector = '';
          let type = '';
          let rep = '';

          const bnoRaw = r['사업자등록번호'] || r['사업자번호'] || '';
          const bnoFromRaw = String(bnoRaw).replace(/[^0-9]/g, '');

          if (bnoFromRaw.length === 10) {
            bno = bnoFromRaw;
            nm = String(r['거래처'] || r['상호명'] || r['업체명'] || r['거래처명'] || '').trim();
            sector = String(r['업태'] || '').trim();
            type = String(r['종목'] || r['업종'] || '').trim();
            rep = String(r['대표자'] || r['대표자명'] || '').trim();
          } else {
            for (const col of cols) {
              const val = String(r[col] || '').replace(/[^0-9]/g, '');
              if (val.length === 10 && col !== 'Code') {
                bno = val;
                break;
              }
            }
            if (!bno) continue;
            nm = String(r['거래처명'] || r['거래처'] || r['상호명'] || r['업체명'] || '').trim();
            sector = String(r['업태'] || '').trim();
            type = String(r['종목'] || r['업종'] || '').trim();
            rep = String(r['대표자'] || r['대표자명'] || '').trim();
          }

          if (!bno) continue;
          if (!map[bno]) {
            map[bno] = { b_no: bno, b_nm: nm, b_sector: sector, b_type: type, p_nm: rep };
          } else {
            if (nm && !map[bno].b_nm) map[bno].b_nm = nm;
            if (sector && !map[bno].b_sector) map[bno].b_sector = sector;
            if (type && !map[bno].b_type) map[bno].b_type = type;
            if (rep && !map[bno].p_nm) map[bno].p_nm = rep;
          }
        }
        resolve(Object.values(map));
      } catch {
        reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기에 실패했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

// ============================================================
// Sub-components
// ============================================================
function UploadPanel({ onDbUpdate }: { onDbUpdate: (count: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ count: number; total: number; files: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList) => {
    const files = Array.from(fileList).filter((f) => f.name.match(/\.xlsx?$/i));
    if (files.length === 0) { setError('xlsx 파일만 업로드 가능합니다.'); return; }
    setLoading(true); setError(''); setStatus(null);
    try {
      const allEntries: Record<string, BusinessData> = {};
      for (const file of files) {
        const entries = await parseBusinessExcel(file);
        for (const e of entries) allEntries[e.b_no] = e;
      }
      const merged = Object.values(allEntries);
      if (merged.length === 0) { setError('사업자번호 데이터를 찾을 수 없습니다.'); return; }
      const result = await uploadToServerDb(merged);
      const stats = await getServerDbStats();
      setStatus({ count: result.count, total: stats.count, files: files.length });
      onDbUpdate(stats.count);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드 실패');
    } finally { setLoading(false); }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-500 font-bold text-sm">
            <span className="spinner" /> 파일 분석 및 업로드 중...
          </div>
        ) : (
          <>
            <div className="text-3xl mb-2">📊</div>
            <p className="text-sm font-bold text-slate-500">클릭하거나 파일을 여기에 끌어다 놓으세요</p>
            <p className="text-[10px] text-slate-300 mt-1">.xlsx 파일 지원 (여러 파일 동시 가능)</p>
          </>
        )}
      </div>
      {error && <p className="text-red-500 text-xs font-bold mt-2">⚠️ {error}</p>}
      {status && (
        <div className="flex gap-3 mt-3 flex-wrap">
          {status.files > 1 && <span className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-1 rounded-full">📁 {status.files}개 파일</span>}
          <span className="bg-green-50 text-green-600 text-xs font-bold px-3 py-1 rounded-full">✅ {status.count}건 업로드</span>
          <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">🗂 총 {status.total}개</span>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className="text-base">{icon}</span>
      <span className="text-[11px] font-bold text-slate-400 w-16 shrink-0">{label}</span>
      <span className="text-sm font-bold text-slate-700 flex-1">{value}</span>
    </div>
  );
}

function NaverCards({ items }: { items: NaverResult[] }) {
  if (items.length === 0) return null;
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mt-4 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 mb-3">
        <span className="bg-green-500 text-white w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black">N</span>
        <span className="text-xs font-bold text-green-700">네이버 검색 결과</span>
        <span className="text-[10px] text-green-400 font-bold ml-auto">{items.length}건</span>
      </div>
      <div className="space-y-3">
        {items.map((info, i) => (
          <div key={i} className={`${i > 0 ? 'pt-3 border-t border-green-200' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-black text-green-800">{info.title}</span>
              {info.link && (
                <a href={info.link} target="_blank" rel="noreferrer" className="text-green-500 text-[10px] font-bold ml-auto hover:underline">바로가기 →</a>
              )}
            </div>
            <div className="space-y-0.5">
              {info.category && <div className="flex gap-2 text-xs"><span className="text-green-400 font-bold w-16 shrink-0">카테고리</span><span className="text-slate-600">{info.category}</span></div>}
              {(info.roadAddress || info.address) && <div className="flex gap-2 text-xs"><span className="text-green-400 font-bold w-16 shrink-0">주소</span><span className="text-slate-600">{info.roadAddress || info.address}</span></div>}
              {info.telephone && <div className="flex gap-2 text-xs"><span className="text-green-400 font-bold w-16 shrink-0">전화번호</span><span className="text-slate-600">{info.telephone}</span></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Guide cards for home state
// ============================================================
const GUIDE_ITEMS = [
  { emoji: '🍽️', title: '음식점', desc: '한식·중식·카페 등', color: '#FF6B35' },
  { emoji: '🏪', title: '편의점', desc: 'GS25·CU 등', color: '#2196F3' },
  { emoji: '⛽', title: '주유소', desc: '주유·LPG 등', color: '#FF9800' },
  { emoji: '🏥', title: '의료기관', desc: '병원·약국 등', color: '#F44336' },
  { emoji: '📚', title: '학원', desc: '어학·보습 등', color: '#9C27B0' },
  { emoji: '🏠', title: '부동산', desc: '공인중개 등', color: '#795548' },
];

// ============================================================
// Main Component
// ============================================================
export default function BusinessLookup({ onBack }: { onBack: () => void }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<BusinessData | null>(null);
  const [resultSource, setResultSource] = useState('');
  const [naverInfo, setNaverInfo] = useState<NaverResult[]>([]);
  const [naverLoading, setNaverLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dbCount, setDbCount] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [manualName, setManualName] = useState('');

  useEffect(() => {
    getServerDbStats().then((s) => setDbCount(s.count || 0)).catch(() => {});
  }, []);

  const handleSearch = async () => {
    const digits = input.replace(/-/g, '');
    if (digits.length !== 10) { setError('사업자등록번호 10자리를 정확히 입력해주세요.'); return; }

    setLoading(true); setError(''); setResult(null); setResultSource(''); setNaverInfo([]); setManualName('');
    try {
      // 1순위: 공유 DB
      const dbResult = await searchServerDb(input);
      if (dbResult) {
        setResult(dbResult); setResultSource('db');
        if (dbResult.b_nm) {
          setNaverLoading(true);
          searchNaver(dbResult.b_nm).then((items) => setNaverInfo(items)).catch(() => {}).finally(() => setNaverLoading(false));
        }
        return;
      }
      // 2순위: 국세청 공공데이터 API
      const nts = await fetchBusinessStatus(input);
      if (nts) { setResult(nts); setResultSource('api'); return; }
      setError('해당 사업자번호로 등록된 정보가 없습니다.');
    } catch {
      setError('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally { setLoading(false); }
  };

  const handleNameSearch = async () => {
    const name = manualName.trim();
    if (!name || !result) return;
    setResult({ ...result, b_nm: name });
    setNaverLoading(true);
    try {
      const items = await searchNaver(name);
      setNaverInfo(items);
    } catch { /* ignore */ } finally { setNaverLoading(false); }
  };

  // 분류 우선순위: 1) DB 데이터(b_nm, b_sector, b_type) → 2) 네이버 이름 일치 결과 카테고리
  const dbCategory = result ? classifyBusinessLocal(result) : null;
  // 네이버 카테고리는 상호명 일치하는 결과만 분류에 활용
  const matchedNaverCategory = (() => {
    if (!result?.b_nm || naverInfo.length === 0) return undefined;
    const matched = naverInfo.find((n) => isNameMatch(n.title, result.b_nm || ''));
    return matched?.category;
  })();
  const category = result
    ? (dbCategory && dbCategory.label !== '일반사업체' ? dbCategory : classifyBusinessLocal(result, matchedNaverCategory))
    : null;
  const statusInfo = result ? getStatusInfo(result.b_stt_cd) : null;

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={onBack} className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors">
        &#8592; 돌아가기
      </button>

      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">사업자 조회</h1>
          <p className="text-blue-100 text-xs font-bold uppercase tracking-widest opacity-80">Business Registration Lookup</p>
        </div>

        <div className="p-6 space-y-5">
          {/* DB toggle */}
          <button
            onClick={() => setShowUpload((v) => !v)}
            className={`w-full py-2 px-4 rounded-xl text-xs font-bold transition-all ${showUpload ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            📂 엑셀 DB 업로드 {dbCount > 0 ? `(${dbCount.toLocaleString()}개 저장됨)` : ''}
          </button>

          {showUpload && <UploadPanel onDbUpdate={setDbCount} />}

          {/* Search */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-1">사업자등록번호</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 p-3 bg-slate-50 border-none rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                placeholder="000-00-00000"
                value={input}
                onChange={(e) => { setInput(formatBizNo(e.target.value)); setResult(null); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                maxLength={12}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl font-black text-sm shadow-lg transition-all active:scale-95"
              >
                {loading ? <span className="spinner" /> : '조회'}
              </button>
            </div>
            {error && <p className="text-red-500 text-xs font-bold mt-2">⚠️ {error}</p>}
          </div>

          {/* Result */}
          {result && category && statusInfo && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4">
              {/* Category badge */}
              <div className="flex items-center gap-2 flex-wrap">
                {result.b_nm && (
                  <span className="px-3 py-1 rounded-full text-xs font-black" style={{ background: category.bg, color: category.color }}>
                    {category.emoji} {category.label}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{
                  background: resultSource === 'db' ? '#EEF2FF' : '#E0F7FA',
                  color: resultSource === 'db' ? '#4338CA' : '#00695C',
                }}>
                  {resultSource === 'db' ? '🗄️ 공유DB' : '🌐 국세청'}
                </span>
              </div>

              {/* One-liner — 분류 가능한 경우만 표시 */}
              {category.label !== '일반사업체' && result.b_nm ? (
                <div className="pl-4 py-2 text-sm font-bold text-slate-700" style={{ borderLeft: `3px solid ${category.color}` }}>
                  {category.emoji}{' '}
                  <strong style={{ color: category.color }}>{result.b_nm}</strong>은{' '}
                  <strong style={{ color: category.color }}>{category.desc}</strong>
                </div>
              ) : !result.b_nm ? (
                <div className="pl-4 py-2 text-sm font-bold text-slate-700" style={{ borderLeft: '3px solid #0288D1' }}>
                  🌐 국세청에서 확인된 사업자입니다. 엑셀 DB를 업로드하면 상세 업종을 확인할 수 있습니다.
                </div>
              ) : null}

              {/* Status chips */}
              <div className="flex gap-2 flex-wrap">
                {result.b_stt_cd && (
                  <span className="px-3 py-1 rounded-full text-[11px] font-bold" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                )}
                {result.tax_type_cd && (
                  <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[11px] font-bold">
                    {getTaxTypeLabel(result.tax_type_cd)}
                  </span>
                )}
              </div>

              {/* Info grid */}
              <div className="bg-slate-50 rounded-2xl p-4">
                <InfoRow icon="🏢" label="상호명" value={result.b_nm || '-'} />
                <InfoRow icon="👤" label="대표자" value={result.p_nm || '-'} />
                <InfoRow icon="📋" label="업태" value={result.b_sector || '-'} />
                <InfoRow icon="🏷️" label="업종" value={result.b_type || '-'} />
                {result.b_adr && <InfoRow icon="📍" label="주소" value={result.b_adr} />}
                {result.start_dt && <InfoRow icon="📅" label="개업일" value={formatDate(result.start_dt)} />}
                {(() => {
                  const acct = getAccountSuggestionLocal(result, category.label);
                  if (!acct) return null;
                  const tagColor = acct.tag === '매입' ? '#7C3AED' : acct.tag === '전송제외' ? '#DC2626' : '#6B7280';
                  const tagBg = acct.tag === '매입' ? '#F3E8FF' : acct.tag === '전송제외' ? '#FEE2E2' : '#F3F4F6';
                  return (
                    <div className="flex items-start gap-3 pt-3 mt-1 border-t border-slate-200">
                      <span className="text-base">📒</span>
                      <span className="text-[11px] font-bold text-slate-400 w-16 shrink-0 pt-0.5">계정과목</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-slate-700">
                            {acct.code ? `${acct.code} ${acct.name}` : acct.tag}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: tagBg, color: tagColor }}>
                            {acct.tag}
                          </span>
                          {!acct.fromPdf && (
                            <span className="text-[10px] font-bold text-amber-500">*확인필요</span>
                          )}
                        </div>
                        {acct.note && (
                          <p className="text-[10px] text-slate-400 font-bold mt-0.5">※ {acct.note}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {resultSource === 'api' && !result.b_nm && (
                <div className="space-y-3">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <p className="text-[11px] text-blue-700 font-bold mb-2">💡 상호명을 입력하면 네이버에서 추가 정보를 검색합니다</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 p-2 bg-white border border-blue-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                        placeholder="예: 쿠팡, 네이버 등"
                        value={manualName}
                        onChange={(e) => setManualName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleNameSearch()}
                      />
                      <button
                        onClick={handleNameSearch}
                        disabled={!manualName.trim()}
                        className="px-4 bg-green-500 hover:bg-green-600 disabled:bg-slate-300 text-white rounded-lg font-bold text-sm transition-all active:scale-95"
                      >
                        검색
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold">
                    ℹ️ 국세청 API는 사업자 상태·과세유형만 제공합니다. 거래처 엑셀을 업로드하면 DB에 상세 정보가 저장됩니다.
                  </p>
                </div>
              )}

              {/* Naver */}
              {naverLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                  <span className="spinner" /> 네이버에서 추가 정보 조회 중...
                </div>
              )}
              {naverInfo.length > 0 && !naverLoading && <NaverCards items={naverInfo} />}

              {/* Footer */}
              <p className="text-center text-[10px] text-slate-300 font-bold pt-2">
                사업자등록번호: {formatBizNo(result.b_no || input)}
              </p>
            </div>
          )}

          {/* Guide cards when no result */}
          {!result && !loading && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {GUIDE_ITEMS.map((g) => (
                <div key={g.title} className="bg-slate-50 rounded-xl p-3 text-center" style={{ borderTop: `3px solid ${g.color}` }}>
                  <div className="text-xl mb-1">{g.emoji}</div>
                  <div className="text-[11px] font-black text-slate-700">{g.title}</div>
                  <div className="text-[9px] text-slate-400">{g.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
