"use client";
import { useState, useEffect } from 'react';

// ── 타입 ───────────────────────────────────────────────────────
interface Review {
  id: number;
  b_no: string;
  current_nm: string | null;
  suggested_nm: string;
  suggested_sector: string | null;
  suggested_type: string | null;
  api_source: string;
  status: string;
  created_at: string;
}

type Tab = 'reviews' | 'verify';
type RunState = 'idle' | 'running' | 'done' | 'error';
type SubmitState = 'idle' | 'loading' | 'done' | 'error';
type SourceFilter = 'all' | 'verifiable' | 'unverifiable';

interface BatchResult {
  processed: number;
  fixed: { b_no: string; old_nm: string | null; new_nm: string }[];
  noApiData: number;
  unchanged: number;
  hasMore: boolean;
  nextOffset: number;
}

interface FixedItem {
  b_no: string;
  old_nm: string | null;
  new_nm: string;
}

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

// ── 수정 폼 컴포넌트 ───────────────────────────────────────────
function ReviewItem({ review, password, onDone, checked, onCheck, sttCd }: {
  review: Review;
  password: string;
  onDone: () => void;
  checked: boolean;
  onCheck: (id: number, checked: boolean, e: React.MouseEvent) => void;
  sttCd?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [nm, setNm] = useState(review.suggested_nm);
  const [sector, setSector] = useState(review.suggested_sector ?? '');
  const [type, setType] = useState(review.suggested_type ?? '');
  const [loading, setLoading] = useState(false);

  const isUnverifiable = review.api_source === 'unverifiable';

  async function act(action: 'approve' | 'reject') {
    setLoading(true);
    await fetch('/api/admin/reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password, id: review.id, b_no: review.b_no, action,
        ...(action === 'approve' && { b_nm: nm, b_sector: sector || undefined, b_type: type || undefined }),
      }),
    });
    setLoading(false);
    onDone();
  }

  return (
    <div className="border border-slate-100 rounded-xl p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => {}}
            onClick={e => onCheck(review.id, !checked, e as React.MouseEvent)}
            className="w-4 h-4 rounded border-slate-300 accent-blue-500 cursor-pointer flex-none"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400">{formatBizNo(review.b_no)}</span>
            <BizSttBadge sttCd={sttCd} />
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isUnverifiable ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
              {review.api_source}
            </span>
          </div>
        </div>
        <span className="text-[10px] text-slate-300">{new Date(review.created_at).toLocaleDateString('ko-KR')}</span>
      </div>

      {/* 이름 비교 / 검증불가 안내 */}
      {isUnverifiable ? (
        <div className="space-y-1">
          <p className="text-xs text-amber-500 font-bold">공공API 조회 불가 — 직접 확인 필요</p>
          <p className="text-sm text-slate-600 font-bold">{review.current_nm || '(상호 없음)'}</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-red-400 font-bold line-through">{review.current_nm || '(없음)'}</span>
          <span className="text-slate-300 text-xs">→</span>
          <span className="text-sm text-green-600 font-black">{review.suggested_nm}</span>
        </div>
      )}

      {/* 수정 폼 */}
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
              {loading ? '적용 중...' : '✅ 적용'}
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
            ✏️ 수정 후 적용
          </button>
          <button onClick={() => act('approve')} disabled={loading}
            className="flex-1 bg-green-50 hover:bg-green-100 disabled:opacity-40 text-green-700 font-black rounded-lg py-2 text-xs transition-colors">
            {loading ? '...' : isUnverifiable ? '✅ 이상없음' : '✅ 그대로 적용'}
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

  // 오염 의심 목록
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [totalReviews, setTotalReviews] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [pageOffset, setPageOffset] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sourceCounts, setSourceCounts] = useState({ verifiable: 0, unverifiable: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastCheckedIdx, setLastCheckedIdx] = useState<number | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bizSttMap, setBizSttMap] = useState<Record<string, string>>({});

  // 수동 검증 실행
  const [runState, setRunState] = useState<RunState>('idle');
  const [progress, setProgress] = useState({ processed: 0, batches: 0 });
  const [summary, setSummary] = useState({ fixed: 0, noApiData: 0, unchanged: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const [fixedItems, setFixedItems] = useState<FixedItem[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitMsg, setSubmitMsg] = useState('');

  async function loadSourceCounts(pw: string) {
    const [verRes, unverRes] = await Promise.all([
      fetch('/api/admin/reviews?' + new URLSearchParams({ password: pw, status: 'pending', source: 'verifiable', limit: '1', offset: '0' })),
      fetch('/api/admin/reviews?' + new URLSearchParams({ password: pw, status: 'pending', source: 'unverifiable', limit: '1', offset: '0' })),
    ]);
    const [verJson, unverJson] = await Promise.all([verRes.json(), unverRes.json()]);
    setSourceCounts({ verifiable: verJson.total ?? 0, unverifiable: unverJson.total ?? 0 });
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/reviews?' + new URLSearchParams({ password, status: 'pending' }));
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
    setSelectedIds(new Set());
    setLastCheckedIdx(null);
    setBizSttMap({});
    try {
      const params = new URLSearchParams({ password: pw, status: 'pending', limit: String(size), offset: String(offset) });
      if (source !== 'all') params.set('source', source);
      const res = await fetch('/api/admin/reviews?' + params);
      if (res.ok) {
        const json = await res.json();
        const loaded: Review[] = json.data ?? [];
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

  // 체크박스 클릭 (shift 범위 선택 포함)
  function handleCheck(id: number, idx: number, newChecked: boolean, e: React.MouseEvent) {
    if (e.shiftKey && lastCheckedIdx !== null) {
      const start = Math.min(lastCheckedIdx, idx);
      const end = Math.max(lastCheckedIdx, idx);
      setSelectedIds(prev => {
        const next = new Set(prev);
        reviews.slice(start, end + 1).forEach(r => next.add(r.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        newChecked ? next.add(id) : next.delete(id);
        return next;
      });
    }
    setLastCheckedIdx(idx);
  }

  async function handleBulkAction() {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    const selectedArr = Array.from(selectedIds);
    const selectedReviews = reviews.filter(r => selectedIds.has(r.id));
    setBulkLoading(true);
    try {
      const res = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, ids: selectedArr, b_nos: selectedReviews.map(r => r.b_no), action: 'approve' }),
      });
      if (res.ok) {
        const count = selectedArr.length;
        setReviews(prev => prev.filter(r => !selectedIds.has(r.id)));
        setTotalReviews(prev => prev - count);
        setSelectedIds(new Set());
        const newPw = sessionStorage.getItem('admin_pw') ?? password;
        loadSourceCounts(newPw);
      }
    } finally { setBulkLoading(false); }
  }

  useEffect(() => { if (authed && tab === 'reviews') loadReviews(0, pageSize); }, [authed, tab]);

  async function runVerify() {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    setRunState('running');
    setProgress({ processed: 0, batches: 0 });
    setSummary({ fixed: 0, noApiData: 0, unchanged: 0 });
    setErrorMsg('');
    setFixedItems([]);
    setSubmitState('idle');
    setSubmitMsg('');

    let offset = 0;
    let totalFixed = 0, totalNoApi = 0, totalUnchanged = 0, batches = 0;

    try {
      while (true) {
        const res = await fetch('/api/admin/verify-businesses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, offset, limit: 50 }),
        });
        if (res.status === 401) { setAuthed(false); setRunState('error'); return; }
        if (!res.ok) { setErrorMsg('오류가 발생했습니다.'); setRunState('error'); return; }

        const data: BatchResult = await res.json();
        batches++;
        totalFixed += data.fixed.length;
        totalNoApi += data.noApiData;
        totalUnchanged += data.unchanged;
        if (data.fixed.length > 0) setFixedItems(prev => [...prev, ...data.fixed]);

        setProgress({ processed: offset + data.processed, batches });
        setSummary({ fixed: totalFixed, noApiData: totalNoApi, unchanged: totalUnchanged });

        if (!data.hasMore) break;
        offset = data.nextOffset;
      }
      setRunState('done');
      if (tab === 'reviews') loadReviews();
    } catch { setErrorMsg('네트워크 오류가 발생했습니다.'); setRunState('error'); }
  }

  async function handleSubmit() {
    const pw = sessionStorage.getItem('admin_pw') ?? password;
    setSubmitState('loading');
    setSubmitMsg('');
    try {
      const res = await fetch('/api/admin/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, items: fixedItems }),
      });
      if (res.status === 401) { setAuthed(false); setSubmitState('error'); return; }
      if (!res.ok) { setSubmitState('error'); setSubmitMsg('전송 중 오류가 발생했습니다.'); return; }
      const json = await res.json();
      setSubmitState('done');
      setSubmitMsg(`${json.applied}건이 반영되었습니다.`);
      setFixedItems([]);
    } catch {
      setSubmitState('error');
      setSubmitMsg('네트워크 오류가 발생했습니다.');
    }
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
            오염 의심 목록
            {totalReviews > 0 && <span className="ml-1.5 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{totalReviews}</span>}
          </button>
          <button onClick={() => setTab('verify')}
            className={`flex-1 py-2 rounded-xl text-sm font-black transition-colors ${tab === 'verify' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            수동 검증
          </button>
        </div>

        {/* ── 오염 의심 목록 탭 ── */}
        {tab === 'reviews' && (
          <div className="space-y-3">
            {/* 소스 필터 */}
            <div className="flex bg-white rounded-2xl p-1 shadow-sm gap-1">
              {([
                { key: 'all', label: `전체`, count: sourceCounts.verifiable + sourceCounts.unverifiable },
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
                    checked={reviews.length > 0 && reviews.every(r => selectedIds.has(r.id))}
                    onChange={e => setSelectedIds(e.target.checked ? new Set(reviews.map(r => r.id)) : new Set())}
                    className="w-4 h-4 rounded border-slate-300 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-500">
                    {selectedIds.size > 0 ? `${selectedIds.size}건 선택됨` : '전체 선택'}
                  </span>
                </label>
                {selectedIds.size > 0 && (
                  <button onClick={handleBulkAction} disabled={bulkLoading}
                    className="bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white font-black rounded-xl px-4 py-1.5 text-xs transition-colors">
                    {bulkLoading ? '처리 중...' : `✅ ${selectedIds.size}건 이상없음 처리`}
                  </button>
                )}
              </div>
            )}

            {reviews.length === 0 && !reviewsLoading && (
              <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
                <div className="text-3xl mb-2">✅</div>
                <p className="text-sm font-bold text-slate-500">오염 의심 데이터가 없습니다</p>
                <p className="text-xs text-slate-400 mt-1">매일 자정에 자동 검증이 실행됩니다</p>
              </div>
            )}

            {reviews.map((r, idx) => (
              <div key={r.id} className="bg-white rounded-2xl shadow-sm p-4">
                <ReviewItem
                  review={r}
                  password={sessionStorage.getItem('admin_pw') ?? password}
                  checked={selectedIds.has(r.id)}
                  sttCd={bizSttMap[r.b_no]}
                  onCheck={(id, newChecked, e) => handleCheck(id, idx, newChecked, e)}
                  onDone={() => {
                    setReviews(prev => prev.filter(x => x.id !== r.id));
                    setTotalReviews(prev => prev - 1);
                    setSelectedIds(prev => { const next = new Set(prev); next.delete(r.id); return next; });
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
              <p className="text-xs text-slate-500">전체 DB를 공공API와 대조해 오염 의심 레코드를 찾습니다.<br/>자동 검증은 매일 자정 GitHub Actions에서 실행됩니다.</p>
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
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-red-50 rounded-xl p-3">
                    <div className="text-xl font-black text-red-500">{summary.fixed}</div>
                    <div className="text-[10px] font-bold text-red-400">오염 의심</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-xl font-black text-slate-400">{summary.noApiData}</div>
                    <div className="text-[10px] font-bold text-slate-400">검증 불가</div>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3">
                    <div className="text-xl font-black text-green-500">{summary.unchanged}</div>
                    <div className="text-[10px] font-bold text-green-400">이상 없음</div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 text-center">총 {progress.processed}건 처리</p>
                {errorMsg && <p className="text-xs text-red-500 font-bold">{errorMsg}</p>}
              </div>
            )}

            {(fixedItems.length > 0 || submitState === 'done') && (
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-700">
                    오염 의심 {fixedItems.length > 0 ? `${fixedItems.length}건` : ''}
                  </p>
                  {fixedItems.length > 0 && (
                    <button
                      onClick={handleSubmit}
                      disabled={submitState === 'loading'}
                      className="bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white font-black rounded-xl px-4 py-2 text-xs transition-colors"
                    >
                      {submitState === 'loading' ? '전송 중...' : '전송하기'}
                    </button>
                  )}
                </div>

                {fixedItems.length > 0 && (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {fixedItems.map((item, i) => (
                      <div key={item.b_no} className="flex items-center gap-2 border border-slate-100 rounded-lg p-2">
                        <span className="text-[11px] font-mono text-slate-400 flex-none">{formatBizNo(item.b_no)}</span>
                        <span className="text-xs text-red-400 line-through flex-none">{item.old_nm || '(없음)'}</span>
                        <span className="text-slate-300 text-xs flex-none">→</span>
                        <input
                          value={item.new_nm}
                          onChange={e => setFixedItems(prev => prev.map((x, j) => j === i ? { ...x, new_nm: e.target.value } : x))}
                          className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-1 text-xs text-green-700 font-bold outline-none focus:border-blue-400"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {submitMsg && (
                  <p className={`text-xs font-bold ${submitState === 'done' ? 'text-green-600' : 'text-red-500'}`}>
                    {submitMsg}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
