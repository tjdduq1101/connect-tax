"use client";
import { useState, useRef } from 'react';

interface FixedRecord {
  b_no: string;
  old_nm: string | null;
  new_nm: string;
}

interface BatchResult {
  processed: number;
  fixed: FixedRecord[];
  noApiData: number;
  unchanged: number;
  hasMore: boolean;
  nextOffset: number;
  dryRun: boolean;
}

type RunState = 'idle' | 'running' | 'done' | 'error';

const BATCH_LIMIT = 50;

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [runState, setRunState] = useState<RunState>('idle');
  const [dryRun, setDryRun] = useState(true);
  const [progress, setProgress] = useState({ processed: 0, total: 0, batches: 0 });
  const [summary, setSummary] = useState({ fixed: 0, noApiData: 0, unchanged: 0 });
  const [fixedRecords, setFixedRecords] = useState<FixedRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(false);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/verify-businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, offset: 0, limit: 0, dryRun: true }),
      });
      if (res.status === 401) {
        setAuthError('비밀번호가 올바르지 않습니다.');
        return;
      }
      sessionStorage.setItem('admin_pw', password);
      setAuthed(true);
    } catch {
      setAuthError('서버 연결에 실패했습니다.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function runVerify(isDryRun: boolean) {
    abortRef.current = false;
    setRunState('running');
    setDryRun(isDryRun);
    setProgress({ processed: 0, total: 0, batches: 0 });
    setSummary({ fixed: 0, noApiData: 0, unchanged: 0 });
    setFixedRecords([]);
    setErrorMsg('');

    const pw = sessionStorage.getItem('admin_pw') ?? password;
    let offset = 0;
    let totalFixed = 0;
    let totalNoApiData = 0;
    let totalUnchanged = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    const allFixed: FixedRecord[] = [];

    try {
      while (true) {
        if (abortRef.current) break;

        const res = await fetch('/api/admin/verify-businesses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, offset, limit: BATCH_LIMIT, dryRun: isDryRun }),
        });

        if (res.status === 401) {
          setAuthed(false);
          setErrorMsg('세션이 만료됐습니다. 다시 로그인하세요.');
          setRunState('error');
          return;
        }
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setErrorMsg(json.error ?? '알 수 없는 오류가 발생했습니다.');
          setRunState('error');
          return;
        }

        const data: BatchResult = await res.json();
        batchCount++;
        totalProcessed += data.processed;
        totalFixed += data.fixed.length;
        totalNoApiData += data.noApiData;
        totalUnchanged += data.unchanged;
        allFixed.push(...data.fixed);

        setProgress({ processed: totalProcessed, total: 0, batches: batchCount });
        setSummary({ fixed: totalFixed, noApiData: totalNoApiData, unchanged: totalUnchanged });
        setFixedRecords([...allFixed]);

        if (!data.hasMore) break;
        offset = data.nextOffset;
      }
      setRunState('done');
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다.');
      setRunState('error');
    }
  }

  function handleStop() {
    abortRef.current = true;
  }

  // ── 비밀번호 입력 화면 ──
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
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              autoFocus
            />
            {authError && (
              <p className="text-xs text-red-500 font-bold">{authError}</p>
            )}
            <button
              type="submit"
              disabled={authLoading || !password}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 text-white disabled:text-slate-400 font-black rounded-xl py-3 text-sm transition-colors"
            >
              {authLoading ? '확인 중...' : '확인'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── 관리자 메인 화면 ──
  const isRunning = runState === 'running';

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* 헤더 */}
        <div className="flex items-center justify-between pt-2 pb-1">
          <div>
            <h1 className="text-lg font-black text-slate-800">DB 오염 데이터 검증</h1>
            <p className="text-xs text-slate-400 mt-0.5">공공API 결과와 이름이 다른 사업자 레코드를 찾아 수정합니다</p>
          </div>
          <button
            onClick={() => { setAuthed(false); sessionStorage.removeItem('admin_pw'); }}
            className="text-xs text-slate-400 hover:text-slate-600 font-bold"
          >
            로그아웃
          </button>
        </div>

        {/* 실행 버튼 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex gap-3">
            <button
              onClick={() => runVerify(true)}
              disabled={isRunning}
              className="flex-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 font-black rounded-xl py-3 text-sm transition-colors"
            >
              🔍 미리보기
            </button>
            <button
              onClick={() => runVerify(false)}
              disabled={isRunning}
              className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white font-black rounded-xl py-3 text-sm transition-colors"
            >
              ✅ 수정 실행
            </button>
          </div>
          <p className="text-[11px] text-slate-400 text-center">
            미리보기는 DB를 변경하지 않습니다. 수정 실행 전에 먼저 미리보기로 확인하세요.
          </p>
        </div>

        {/* 진행 상황 */}
        {runState !== 'idle' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-slate-700">
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
                    처리 중... ({progress.batches}배치 완료)
                  </span>
                ) : runState === 'done' ? (
                  `완료 ${dryRun ? '(미리보기)' : '(수정 적용)'}`
                ) : '오류 발생'}
              </span>
              {isRunning && (
                <button
                  onClick={handleStop}
                  className="text-xs text-red-400 hover:text-red-600 font-bold"
                >
                  중단
                </button>
              )}
            </div>

            {/* 요약 카드 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-red-500">{summary.fixed}</div>
                <div className="text-[10px] font-bold text-red-400 mt-0.5">
                  {dryRun ? '오염 의심' : '수정 완료'}
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-slate-400">{summary.noApiData}</div>
                <div className="text-[10px] font-bold text-slate-400 mt-0.5">검증 불가</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-500">{summary.unchanged}</div>
                <div className="text-[10px] font-bold text-green-400 mt-0.5">이상 없음</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              총 {progress.processed}건 처리
              {summary.noApiData > 0 && ` · 검증 불가 ${summary.noApiData}건은 공공API에 등록되지 않은 사업자`}
            </p>

            {/* 오류 메시지 */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 font-bold">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* 오염 레코드 목록 */}
        {fixedRecords.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-black text-slate-700 mb-3">
              {dryRun ? '오염 의심 목록' : '수정된 목록'} ({fixedRecords.length}건)
            </h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {fixedRecords.map((r) => (
                <div key={r.b_no} className="border border-slate-100 rounded-xl p-3">
                  <div className="text-[11px] font-bold text-slate-400 mb-1">
                    {r.b_no.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3')}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-red-500 font-bold line-through">{r.old_nm || '(없음)'}</span>
                    <span className="text-slate-300 text-xs">→</span>
                    <span className="text-sm text-green-600 font-black">{r.new_nm}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
