"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

interface BusinessData {
  b_no: string;
  b_nm?: string;
  p_nm?: string;
  b_sector?: string;
  b_type?: string;
}

interface AccountHistoryEntry {
  b_no: string;
  account_name: string;
  count: number;
}

interface ParseResult {
  businesses: BusinessData[];
  accountHistory: AccountHistoryEntry[];
}

// ============================================================
// API helpers
// ============================================================
async function uploadToServerDb(businesses: BusinessData[]) {
  const res = await fetch("/api/db/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businesses }),
  });
  if (!res.ok) throw new Error("사업자 정보 업로드 실패");
  return res.json() as Promise<{ count: number }>;
}

async function uploadAccountHistory(entries: AccountHistoryEntry[]) {
  if (entries.length === 0) return { count: 0 };
  const res = await fetch("/api/db/upload-account-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error("분류 이력 업로드 실패");
  return res.json() as Promise<{ count: number }>;
}

async function getServerDbStats(): Promise<{ count: number }> {
  const res = await fetch("/api/db/stats");
  if (!res.ok) return { count: 0 };
  return res.json();
}

// ============================================================
// 거래처명 정규화 (합성키용)
// ============================================================
function normalizeBusinessName(nm: string): string {
  return nm.replace(/(주식회사|유한회사|\(주\)|㈜|\s)/g, "").toLowerCase();
}

// 현금영수증 Excel에서 실제 거래처명 추출
// 거래처 컬럼이 일반명("현금영수증(매입)" 등)이면 품명을 사용
const GENERIC_TRADE_NAMES = ["현금영수증(매입)", "현금영수증", "현금 영수증"];
function resolveBusinessName(tradeName: string, itemName: string): string {
  const trimmed = tradeName.trim();
  if (!trimmed || GENERIC_TRADE_NAMES.includes(trimmed)) {
    return itemName.trim();
  }
  return trimmed;
}

// ============================================================
// Excel parser — 신용카드 / 현금영수증 양식 모두 지원
// ============================================================
function parseBusinessExcel(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, string | number>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (rows.length === 0) return resolve({ businesses: [], accountHistory: [] });

        const cols = Object.keys(rows[0] || {});
        const bizMap: Record<string, BusinessData> = {};
        // 동일 파일 내 (b_no, account_name) → count 집계
        const historyMap: Record<string, number> = {};

        for (const r of rows) {
          // ── 사업자번호 추출 ──────────────────────────────
          let bno = "";
          let nm = "";
          let sector = "";
          let type = "";
          let rep = "";

          const bnoRaw = r["사업자등록번호"] || r["사업자번호"] || r["거래처사업자등록번호"] || "";
          const bnoFromRaw = String(bnoRaw).replace(/[^0-9]/g, "");

          if (bnoFromRaw.length === 10) {
            bno = bnoFromRaw;
          } else {
            // 다른 컬럼에서 10자리 탐색
            for (const col of cols) {
              const val = String(r[col] || "").replace(/[^0-9]/g, "");
              if (val.length === 10 && col !== "Code") {
                bno = val;
                break;
              }
            }
          }

          // ── 거래처명 추출 (신용카드: 거래처, 현금영수증: 거래처 or 품명) ──
          const rawTrade = String(r["거래처"] || r["상호명"] || r["거래처명"] || r["업체명"] || r["가맹점상호"] || "").trim();
          const rawItem = String(r["품명"] || "").trim();
          nm = resolveBusinessName(rawTrade, rawItem);

          sector = String(r["업태"] || "").trim();
          type = String(r["종목"] || r["업종"] || "").trim();
          rep = String(r["대표자"] || r["대표자명"] || "").trim();

          // 사업자번호 없으면 상호명 합성키
          if (!bno && nm) {
            bno = "nm_" + normalizeBusinessName(nm);
          }
          if (!bno) continue;

          // ── businesses 집계 ──────────────────────────────
          if (!bizMap[bno]) {
            bizMap[bno] = { b_no: bno, b_nm: nm, b_sector: sector, b_type: type, p_nm: rep };
          } else {
            if (nm && !bizMap[bno].b_nm) bizMap[bno].b_nm = nm;
            if (sector && !bizMap[bno].b_sector) bizMap[bno].b_sector = sector;
            if (type && !bizMap[bno].b_type) bizMap[bno].b_type = type;
            if (rep && !bizMap[bno].p_nm) bizMap[bno].p_nm = rep;
          }

          // ── 차변계정 빈도수 집계 ─────────────────────────
          const accountName = String(r["차변계정"] || "").trim();
          if (accountName) {
            const key = `${bno}|||${accountName}`;
            historyMap[key] = (historyMap[key] ?? 0) + 1;
          }
        }

        const accountHistory: AccountHistoryEntry[] = Object.entries(historyMap).map(
          ([key, count]) => {
            const [b_no, account_name] = key.split("|||");
            return { b_no, account_name, count };
          }
        );

        resolve({ businesses: Object.values(bizMap), accountHistory });
      } catch {
        reject(new Error("파일을 읽는 중 오류가 발생했습니다."));
      }
    };
    reader.onerror = () => reject(new Error("파일 읽기에 실패했습니다."));
    reader.readAsArrayBuffer(file);
  });
}

// ============================================================
// Main Component
// ============================================================
export default function DbUpload({ onBack }: { onBack: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{
    bizCount: number;
    historyCount: number;
    total: number;
    files: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dbCount, setDbCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getServerDbStats().then((s) => setDbCount(s.count || 0)).catch(() => {});
  }, []);

  const handleFiles = async (fileList: FileList) => {
    const files = Array.from(fileList).filter((f) => f.name.match(/\.xlsx?$/i));
    if (files.length === 0) { setError("xlsx 파일만 업로드 가능합니다."); return; }
    setLoading(true); setError(""); setStatus(null);
    try {
      const allBiz: Record<string, BusinessData> = {};
      const allHistoryMap: Record<string, number> = {};

      for (const file of files) {
        const { businesses, accountHistory } = await parseBusinessExcel(file);
        for (const b of businesses) allBiz[b.b_no] = b;
        for (const h of accountHistory) {
          const key = `${h.b_no}|||${h.account_name}`;
          allHistoryMap[key] = (allHistoryMap[key] ?? 0) + h.count;
        }
      }

      const mergedBiz = Object.values(allBiz);
      const mergedHistory: AccountHistoryEntry[] = Object.entries(allHistoryMap).map(
        ([key, count]) => {
          const [b_no, account_name] = key.split("|||");
          return { b_no, account_name, count };
        }
      );

      if (mergedBiz.length === 0 && mergedHistory.length === 0) {
        setError("인식 가능한 데이터를 찾을 수 없습니다.");
        return;
      }

      const [bizResult, histResult, stats] = await Promise.all([
        mergedBiz.length > 0 ? uploadToServerDb(mergedBiz) : Promise.resolve({ count: 0 }),
        mergedHistory.length > 0 ? uploadAccountHistory(mergedHistory) : Promise.resolve({ count: 0 }),
        getServerDbStats(),
      ]);

      setStatus({
        bizCount: bizResult.count,
        historyCount: histResult.count,
        total: stats.count,
        files: files.length,
      });
      setDbCount(stats.count);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={onBack}
        className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors"
      >
        &#8592; 돌아가기
      </button>

      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-sky-500 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">분류DB 관리</h1>
          <p className="text-sky-100 text-xs font-bold uppercase tracking-widest opacity-80">
            Classification Database Upload
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* 현재 DB 현황 */}
          <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-2xl">🗂</span>
            <div>
              <p className="text-xs font-bold text-slate-400">현재 저장된 거래처</p>
              <p className="text-2xl font-black text-slate-800">
                {dbCount.toLocaleString()}
                <span className="text-sm font-bold text-slate-400 ml-1">개</span>
              </p>
            </div>
          </div>

          {/* 안내 */}
          <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-black text-sky-700">📋 지원 파일 형식</p>
            <ul className="text-[11px] text-sky-600 font-bold space-y-1 ml-2">
              <li>· 신용카드(매입), 현금영수증(매입), 사업용신용카드거래내역 .xlsx/.xls</li>
              <li>· 차변계정 컬럼이 있으면 분류 이력도 함께 저장</li>
              <li>· 여러 파일 동시 업로드 가능</li>
            </ul>
          </div>

          {/* 업로드 영역 */}
          <div
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
              dragging ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:border-sky-300"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-slate-500 font-bold text-sm">
                <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                파일 분석 및 업로드 중...
              </div>
            ) : (
              <>
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm font-bold text-slate-500">클릭하거나 파일을 여기에 끌어다 놓으세요</p>
                <p className="text-[10px] text-slate-300 mt-1">.xlsx / .xls 파일 지원 · 여러 파일 동시 가능</p>
              </>
            )}
          </div>

          {error && <p className="text-red-500 text-xs font-bold">⚠️ {error}</p>}

          {status && (
            <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-black text-green-700">✅ 업로드 완료</p>
              <div className="flex gap-2 flex-wrap">
                {status.files > 1 && (
                  <span className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-1 rounded-full">
                    📁 {status.files}개 파일
                  </span>
                )}
                <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                  🏢 사업자 {status.bizCount}건
                </span>
                {status.historyCount > 0 && (
                  <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full">
                    📒 분류이력 {status.historyCount}건
                  </span>
                )}
                <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">
                  🗂 총 {status.total}개
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
