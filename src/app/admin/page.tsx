"use client";
import { useState, useEffect } from 'react';

// ── 타입 ───────────────────────────────────────────────────────
interface ReviewRecord {
  b_no: string;
  b_nm: string | null;
  suggested_nm: string | null;
  suggested_sector: string | null;
  suggested_type: string | null;
  api_source: string | null;
  verify_status: string;
  updated_at: string;
}

type Tab = 'reviews' | 'verify';
type RunState = 'idle' | 'running' | 'done' | 'error';
type SourceFilter = 'all' | 'verifiable' | 'unverifiable';

// ── 유틸 ───────────────────────────────────────────────────────
function formatBizNo(bno: string) {
  return bno.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3');
}

// ── 폐업 배지 ─────────────────────────────────────────────────
function BizSttBadge({ sttCd }: { sttCd?: string }) {
  if (sttCd === '03') return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-100 text-red-600">폐업</span>;
  if (sttCd === '02') return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-orange-100 text-orange-600">휴업</span>;
  return null;
}

// ── 리뷰 아이템 컴포넌트 ───────────────────────────────────────
function ReviewItem({ record, password, onDone, checked, onCheck, sttCd }: {
  record: ReviewRecord;
  password: string;
  onDone: () => void;
  checked: boolean;
  onCheck: (bno: string, checked: boolean, e: React.MouseEvent) => void;
  sttCd?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [nm, setNm] = useState(record.suggested_nm ?? '');
  const [sector, setSector] = useState(record.suggested_sector ?? '');
  const [type, setType] = useState(record.suggested_type ?? '');
  const [loading, setLoading] = useState(false);

  const isUnverifiable = record.api_source === 'unverifiable';

  async function act(action: 'approve' | 'reject') {
    setLoading(true);
    await fetch('/api/admin/reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password, b_no: record.b_no, action,
        ...(action === 'approve' && { b_nm: nm, b_sector: sector || undefined, b_type: type || undefined }),
      }),
    });
    setLoading(false);
    onDone();
  }

  return (
    <div className="border border-slate-100 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => {}}
            onClick={e => onCheck(record.b_no, !checked, e as React.MouseEvent)}
            className="w-4 h-4 rounded border-slate-300 accent-blue-500 cursor-pointer flex-none"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400">{formatBizNo(record.b_no)}</span>
            <BizSttBadge sttCd={sttCd} />
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isUnverifiable ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
              {record.api_source ?? ''}
            </span>
          </div>
        </div>
        <span className="text-[10px] text-slate-300">{new Date(record.updated_at).toLocaleDateString('ko-KR')}</span>
      </div>

      {isUnverifiable ? (
        <div className="space-y-1">
          <p className="text-xs text-amber-500 font-bold">공공API 조회 불가 — 직접 확인 필요</p>
          <p className="text-sm text-slate-600 font-bold">{record.b_nm || '(상호 없음)'}</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-red-400 font-bold line-through">{record.b_nm || '(없음)'}</span>
          <span className="text-slate-300 text-xs">→</span>
          <span className="text-sm text-green-600 font-black">{record.suggested_nm}</span>
        </div>
      )}

      {editing ? (
        <div className="space-y-2 pt-1">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-0.5">상호명</label>
            <input value={nm} onChange={e => setNm(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-slate-400 block mb-0.5">업태</label>
              <input value={sector} onChange={e => setSector(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-bold text-slate-400 block mb-0.5">업종</label>
              <input value={type} onChange={e => setType(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => act('approve')} disabled={loading || !nm}
              className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white font-black rounded-lg py-2 text-xs transition-colors">
              {loading ? '적용 중...' : '적용'}
            </button>
            <button onClick={() => setEditing(false)} disabled={loading}
              className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg py-2 text-xs">
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)}
            className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-600 font-black rounded-lg py-2 text-xs transition-colors">
            수정 후 적용
          </button>
          <button onClick={() => act('approve')} disabled={loading}
            className="flex-1 bg-green-50 hover:bg-green-100 disabled:opacity-40 text-green-700 font-black rounded-lg py-2 text-xs transition-colors">
            {loading ? '...' : isUnverifiable ? '이상없음' : '그대로 적용'}
          </button>
          <button onClick={() => act('reject')} disabled={loading}
            className="px-4 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-500 font-bold rounded-lg py-2 text-xs transition-colors">
            무시
          </button>
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────
export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('reviews');

  // 확인 필요 목록
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [totalReviews, setTotalReviews] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [pageOffset, setPageOffset] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sourceCounts, setSourceCounts] = useState({ verifiable: 0, unverifiable: 0 });
  const [selectedBnos, setSelectedBnos] = useState<Set<string>>(new Set());
  const [lastCheckedIdx, setLastCheckedIdx] = useState<number | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bizSttMap, setBizSttMap] = useState<Record<string, string>>({});
  const [rejectClosedState, setRejectClosedState] = useState<'idle' | 'running' | 'done'>('idle');
  const [rejectClosedProgress, setRejectClosedProgress] = useState({ processed: 0, deleted: 0 });

  // 수동 검증
  const [runState, setRunState] = useState<RunState>('idle');
  const [progress, setProgress] = useState({ processed: 0, batches: 0 });
  const [summary, setSummary] = useState({ verified: 0, needsReview: 0, deleted: 0, unverifiable: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  async function loadSourceCounts(pw: string) {
    const [verRes, unverRes] = await Promise.all([
      fetch('/api/admin/reviews?' + new URLSearchParams({ password: pw, source: 'verifiable', limit: '1', offset: '0' })),
      fetch('/api/admin/reviews?' + new URLSearchParams({ password: pw, source: 'unverifiable', limit: '1', offset: '0' })),
    ]);
    const [verJson, unverJson] = await Promise.all([verRes.json(), unverRes.json()]);
    setSourceCounts({ verifiable: verJson.total ?? 0, unverifiable: unverJson.total ?? 0 });
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/reviews?' + new URLSearchParams({ password }));
      if (res.status === 401) { setAuthError('비밀번호가 올바르지 않습니다.'); return; }
      const json = await res.json();
      sessionStorage.setItem('admin_pw', password);
      setAuthed(true);
      setReviews(json.data ?? []);
      setTotalReviews(json.total ?? 0);
      loadSourceCounts(password);
    } catch { setAuthError('서버 연결에 실패했습니다.'); }
    finally { setAuthLoading(false); }
  }

  async function fetchBizStt(bnos: string[]) {
    if (bnos.length === 0) return;
    try {
      const res = await fetch('/api/nts/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b_no: bnos }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const map: Record<string, string> = {};
      for (const item of (json.data ?? []) as { b_no: string; b_stt_cd?: string }[]) {
        if (item.b_stt_cd) map[item.b_no] = item.b_stt_cd;
      }
      setBizSttMap(map);
    } catch { /* 조회 실패 시 배지만 안 뜨면 됨 */ }
  }

  async function loadReviews(offset = 0, size = pageSize, source: SourceFilter = sourceFilter) {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    setReviewsLoading(true);
    setSelectedBnos(new Set());
    setLastCheckedIdx(null);
    setBizSttMap({});
    try {
      const params = new URLSearchParams({ password: pw, limit: String(size), offset: String(offset) });
      if (source !== 'all') params.set('source', source);
      const res = await fetch('/api/admin/reviews?' + params);
      if (res.ok) {
        const json = await res.json();
        const loaded: ReviewRecord[] = json.data ?? [];
        setReviews(loaded);
        setTotalReviews(json.total ?? 0);
        fetchBizStt(loaded.map(r => r.b_no));
      }
    } finally { setReviewsLoading(false); }
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPageOffset(0);
    loadReviews(0, size);
  }

  function handleSourceFilterChange(source: SourceFilter) {
    setSourceFilter(source);
    setPageOffset(0);
    loadReviews(0, pageSize, source);
  }

  function handlePrev() {
    const next = Math.max(0, pageOffset - pageSize);
    setPageOffset(next);
    loadReviews(next, pageSize);
  }

  function handleNext() {
    const next = pageOffset + pageSize;
    setPageOffset(next);
    loadReviews(next, pageSize);
  }

  function handleCheck(bno: string, idx: number, newChecked: boolean, e: React.MouseEvent) {
    if (e.shiftKey && lastCheckedIdx !== null) {
      const start = Math.min(lastCheckedIdx, idx);
      const end = Math.max(lastCheckedIdx, idx);
      setSelectedBnos(prev => {
        const next = new Set(prev);
        reviews.slice(start, end + 1).forEach(r => next.add(r.b_no));
        return next;
      });
    } else {
      setSelectedBnos(prev => {
        const next = new Set(prev);
        newChecked ? next.add(bno) : next.delete(bno);
        return next;
      });
    }
    setLastCheckedIdx(idx);
  }

  async function handleBulkAction() {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    const selectedArr = Array.from(selectedBnos);
    setBulkLoading(true);
    try {
      const res = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, b_nos: selectedArr, action: 'approve' }),
      });
      if (res.ok) {
        const count = selectedArr.length;
        setReviews(prev => prev.filter(r => !selectedBnos.has(r.b_no)));
        setTotalReviews(prev => prev - count);
        setSelectedBnos(new Set());
        loadSourceCounts(pw);
      }
    } finally { setBulkLoading(false); }
  }

  async function handleRejectClosed() {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    setRejectClosedState('running');
    setRejectClosedProgress({ processed: 0, deleted: 0 });
    let totalProcessed = 0, totalDeleted = 0;
    try {
      while (true) {
        const res = await fetch('/api/admin/reject-closed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, limit: 100 }),
        });
        if (!res.ok) break;
        const data = await res.json() as { processed: number; deleted: number; hasMore: boolean };
        totalProcessed += data.processed;
        totalDeleted += data.deleted;
        setRejectClosedProgress({ processed: totalProcessed, deleted: totalDeleted });
        if (!data.hasMore) break;
      }
    } finally {
      setRejectClosedState('done');
      loadReviews(0, pageSize);
      loadSourceCounts(sessionStorage.getItem('admin_pw') ?? password);
    }
  }

  useEffect(() => { if (authed && tab === 'reviews') loadReviews(0, pageSize); }, [authed, tab]);

  async function runVerify() {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    setRunState('running');
    setProgress({ processed: 0, batches: 0 });
    setSummary({ verified: 0, needsReview: 0, deleted: 0, unverifiable: 0 });
    setErrorMsg('');

    let totalVerified = 0, totalNeedsReview = 0, totalDeleted = 0, totalUnverifiable = 0;
    let totalProcessed = 0, batches = 0;

    try {
      while (true) {
        const res = await fetch('/api/admin/verify-businesses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, limit: 50 }),
        });
        if (res.status === 401) { setAuthed(false); setRunState('error'); return; }
        if (!res.ok) { setErrorMsg('오류가 발생했습니다.'); setRunState('error'); return; }

        const data = await res.json() as {
          processed: number; verified: number; needsReview: number;
          deleted: number; unverifiable: number; hasMore: boolean;
        };
        batches++;
        totalProcessed += data.processed;
        totalVerified += data.verified;
        totalNeedsReview += data.needsReview;
        totalDeleted += data.deleted;
        totalUnverifiable += data.unverifiable;

        setProgress({ processed: totalProcessed, batches });
        setSummary({ verified: totalVerified, needsReview: totalNeedsReview, deleted: totalDeleted, unverifiable: totalUnverifiable });

        if (!data.hasMore) break;
      }
      setRunState('done');
      if (tab === 'reviews') loadReviews();
    } catch { setErrorMsg('네트워크 오류가 발생했습니다.'); setRunState('error'); }
  }

  // ── 비밀번호 화면 ──────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">🔐</div>
            <h1 className="text-lg font-black text-slate-800">관리자 페이지</h1>
            <p className="text-xs text-slate-400 mt-1">비밀번호를 입력하세요</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-3">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호" autoFocus
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            {authError && <p className="text-xs text-red-500 font-bold">{authError}</p>}
            <button type="submit" disabled={authLoading || !password}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 text-white disabled:text-slate-400 font-black rounded-xl py-3 text-sm transition-colors">
              {authLoading ? '확인 중...' : '확인'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── 메인 화면 ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* 헤더 */}
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-lg font-black text-slate-800">관리자</h1>
          <button onClick={() => { setAuthed(false); sessionStorage.removeItem('admin_pw'); }}
            className="text-xs text-slate-400 hover:text-slate-600 font-bold">로그아웃</button>
        </div>

        {/* 탭 */}
        <div className="flex bg-white rounded-2xl p-1 shadow-sm gap-1">
          <button onClick={() => setTab('reviews')}
            className={`flex-1 py-2 rounded-xl text-sm font-black transition-colors ${tab === 'reviews' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            확인 필요 목록
            {totalReviews > 0 && <span className="ml-1.5 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{totalReviews}</span>}
          </button>
          <button onClick={() => setTab('verify')}
            className={`flex-1 py-2 rounded-xl text-sm font-black transition-colors ${tab === 'verify' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            수동 검증
          </button>
        </div>

        {/* ── 확인 필요 목록 탭 ── */}
        {tab === 'reviews' && (
          <div className="space-y-3">
            {/* 폐업 자동 삭제 */}
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-slate-700">폐업 자동 삭제</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {rejectClosedState === 'idle' && '국세청 조회 후 폐업 사업자를 DB에서 삭제합니다.'}
                  {rejectClosedState === 'running' && `처리 중... ${rejectClosedProgress.processed}건 확인 / ${rejectClosedProgress.deleted}건 삭제됨`}
                  {rejectClosedState === 'done' && `완료 — ${rejectClosedProgress.processed}건 확인, ${rejectClosedProgress.deleted}건 삭제됨`}
                </p>
              </div>
              <button
                onClick={handleRejectClosed}
                disabled={rejectClosedState === 'running'}
                className="flex-none bg-red-50 hover:bg-red-100 disabled:opacity-40 text-red-600 font-black rounded-xl px-4 py-2 text-xs transition-colors whitespace-nowrap">
                {rejectClosedState === 'running' ? '처리 중...' : '🗑 실행'}
              </button>
            </div>

            {/* 소스 필터 */}
            <div className="flex bg-white rounded-2xl p-1 shadow-sm gap-1">
              {([
                { key: 'all', label: '전체', count: sourceCounts.verifiable + sourceCounts.unverifiable },
                { key: 'verifiable', label: '조회 가능', count: sourceCounts.verifiable },
                { key: 'unverifiable', label: '조회 불가', count: sourceCounts.unverifiable },
              ] as const).map(({ key, label, count }) => (
                <button key={key} onClick={() => handleSourceFilterChange(key)} disabled={reviewsLoading}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-black transition-colors disabled:opacity-40 ${sourceFilter === key ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {label}
                  <span className={`ml-1 text-[10px] font-bold ${sourceFilter === key ? 'text-blue-100' : 'text-slate-400'}`}>{count}</span>
                </button>
              ))}
            </div>

            {/* 컨트롤 바 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  {reviewsLoading ? '불러오는 중...' : `미처리 ${totalReviews}건`}
                </p>
                <button onClick={() => { loadReviews(pageOffset, pageSize); loadSourceCounts(sessionStorage.getItem('admin_pw') ?? password); }} disabled={reviewsLoading}
                  className="text-xs text-blue-500 font-bold disabled:opacity-40">새로고침</button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-400 mr-1">페이지당</span>
                  {([20, 50, 100, 0] as const).map(size => (
                    <button key={size} onClick={() => handlePageSizeChange(size)} disabled={reviewsLoading}
                      className={`text-[11px] px-2 py-0.5 rounded-lg font-bold transition-colors disabled:opacity-40 ${pageSize === size ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {size === 0 ? '전체' : size}
                    </button>
                  ))}
                </div>
                {pageSize > 0 && totalReviews > pageSize && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={handlePrev} disabled={pageOffset === 0 || reviewsLoading}
                      className="text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40 font-bold">이전</button>
                    <span className="text-[11px] text-slate-400">
                      {pageOffset + 1}–{Math.min(pageOffset + pageSize, totalReviews)} / {totalReviews}
                    </span>
                    <button onClick={handleNext} disabled={pageOffset + pageSize >= totalReviews || reviewsLoading}
                      className="text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40 font-bold">다음</button>
                  </div>
                )}
              </div>
            </div>

            {/* 전체 선택 / 일괄 처리 바 */}
            {reviews.length > 0 && (
              <div className="flex items-center justify-between bg-white rounded-2xl px-4 py-2.5 shadow-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reviews.length > 0 && reviews.every(r => selectedBnos.has(r.b_no))}
                    onChange={e => setSelectedBnos(e.target.checked ? new Set(reviews.map(r => r.b_no)) : new Set())}
                    className="w-4 h-4 rounded border-slate-300 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-500">
                    {selectedBnos.size > 0 ? `${selectedBnos.size}건 선택됨` : '전체 선택'}
                  </span>
                </label>
                {selectedBnos.size > 0 && (
                  <button onClick={handleBulkAction} disabled={bulkLoading}
                    className="bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white font-black rounded-xl px-4 py-1.5 text-xs transition-colors">
                    {bulkLoading ? '처리 중...' : `${selectedBnos.size}건 승인 처리`}
                  </button>
                )}
              </div>
            )}

            {reviews.length === 0 && !reviewsLoading && (
              <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
                <div className="text-3xl mb-2">✅</div>
                <p className="text-sm font-bold text-slate-500">확인 필요한 데이터가 없습니다</p>
                <p className="text-xs text-slate-400 mt-1">매일 자정에 자동 검증이 실행됩니다</p>
              </div>
            )}

            {reviews.map((r, idx) => (
              <div key={r.b_no} className="bg-white rounded-2xl shadow-sm p-4">
                <ReviewItem
                  record={r}
                  password={sessionStorage.getItem('admin_pw') ?? password}
                  checked={selectedBnos.has(r.b_no)}
                  sttCd={bizSttMap[r.b_no]}
                  onCheck={(bno, newChecked, e) => handleCheck(bno, idx, newChecked, e)}
                  onDone={() => {
                    setReviews(prev => prev.filter(x => x.b_no !== r.b_no));
                    setTotalReviews(prev => prev - 1);
                    setSelectedBnos(prev => { const next = new Set(prev); next.delete(r.b_no); return next; });
                    setLastCheckedIdx(null);
                    loadSourceCounts(sessionStorage.getItem('admin_pw') ?? password);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* ── 수동 검증 탭 ── */}
        {tab === 'verify' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <p className="text-xs text-slate-500">미검사(unscanned) 상태의 사업자를 공공API와 대조합니다.<br/>자동 검증은 매일 자정 GitHub Actions에서 실행됩니다.</p>
              <button onClick={runVerify} disabled={runState === 'running'}
                className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white font-black rounded-xl py-3 text-sm transition-colors">
                {runState === 'running' ? '검증 중...' : '지금 바로 검증 실행'}
              </button>
            </div>

            {runState !== 'idle' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                  {runState === 'running' && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />}
                  {runState === 'running' ? `처리 중... (${progress.batches}배치)` : runState === 'done' ? '완료' : '오류'}
                </div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div className="bg-green-50 rounded-xl p-3">
                    <div className="text-xl font-black text-green-500">{summary.verified}</div>
                    <div className="text-[10px] font-bold text-green-400">이상없음</div>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3">
                    <div className="text-xl font-black text-red-500">{summary.needsReview}</div>
                    <div className="text-[10px] font-bold text-red-400">확인필요</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-xl font-black text-slate-500">{summary.deleted}</div>
                    <div className="text-[10px] font-bold text-slate-400">폐업삭제</div>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3">
                    <div className="text-xl font-black text-amber-500">{summary.unverifiable}</div>
                    <div className="text-[10px] font-bold text-amber-400">검증불가</div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 text-center">총 {progress.processed}건 처리</p>
                {errorMsg && <p className="text-xs text-red-500 font-bold">{errorMsg}</p>}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
