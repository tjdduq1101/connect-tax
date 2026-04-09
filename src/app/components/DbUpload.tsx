"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

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

// ============================================================
// API helpers
// ============================================================
async function uploadToServerDb(businesses: BusinessData[]) {
  const res = await fetch("/api/db/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businesses }),
  });
  if (!res.ok) throw new Error("업로드 실패");
  return res.json();
}

async function getServerDbStats(): Promise<{ count: number }> {
  const res = await fetch("/api/db/stats");
  if (!res.ok) return { count: 0 };
  return res.json();
}

// ============================================================
// Excel parser — 사업자번호 기반, 다양한 컬럼명 지원
// ============================================================
function parseBusinessExcel(file: File): Promise<BusinessData[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (rows.length === 0) return resolve([]);

        const cols = Object.keys(rows[0] || {});
        const map: Record<string, BusinessData> = {};

        for (const r of rows) {
          let bno = "";
          let nm = "";
          let sector = "";
          let type = "";
          let rep = "";

          const bnoRaw = r["사업자등록번호"] || r["사업자번호"] || "";
          const bnoFromRaw = String(bnoRaw).replace(/[^0-9]/g, "");

          if (bnoFromRaw.length === 10) {
            bno = bnoFromRaw;
            nm = String(r["거래처"] || r["상호명"] || r["업체명"] || r["거래처명"] || "").trim();
            sector = String(r["업태"] || "").trim();
            type = String(r["종목"] || r["업종"] || "").trim();
            rep = String(r["대표자"] || r["대표자명"] || "").trim();
          } else {
            // 사업자번호 없는 경우: 다른 컬럼에서 10자리 탐색
            for (const col of cols) {
              const val = String(r[col] || "").replace(/[^0-9]/g, "");
              if (val.length === 10 && col !== "Code") {
                bno = val;
                break;
              }
            }
            nm = String(r["거래처명"] || r["거래처"] || r["상호명"] || r["업체명"] || "").trim();
            sector = String(r["업태"] || "").trim();
            type = String(r["종목"] || r["업종"] || "").trim();
            rep = String(r["대표자"] || r["대표자명"] || "").trim();

            // 사업자번호가 없어도 상호명이 있으면 합성키로 저장
            if (!bno && nm) {
              bno = "nm_" + nm.replace(/(주식회사|유한회사|\(주\)|㈜|\s)/g, "").toLowerCase();
            }
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
  const [status, setStatus] = useState<{ count: number; total: number; files: number } | null>(null);
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
      const allEntries: Record<string, BusinessData> = {};
      for (const file of files) {
        const entries = await parseBusinessExcel(file);
        for (const e of entries) allEntries[e.b_no] = e;
      }
      const merged = Object.values(allEntries);
      if (merged.length === 0) { setError("사업자번호 데이터를 찾을 수 없습니다."); return; }
      const result = await uploadToServerDb(merged);
      const stats = await getServerDbStats();
      setStatus({ count: result.count, total: stats.count, files: files.length });
      setDbCount(stats.count);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "업로드 실패");
    } finally { setLoading(false); }
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
        <div className="bg-violet-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">거래처 DB 관리</h1>
          <p className="text-violet-200 text-xs font-bold uppercase tracking-widest opacity-80">
            Business Database Upload
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* 현재 DB 현황 */}
          <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-2xl">🗂</span>
            <div>
              <p className="text-xs font-bold text-slate-400">현재 저장된 거래처</p>
              <p className="text-2xl font-black text-slate-800">{dbCount.toLocaleString()}<span className="text-sm font-bold text-slate-400 ml-1">개</span></p>
            </div>
          </div>

          {/* 안내 */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-black text-violet-700">📋 지원 파일 형식</p>
            <ul className="text-[11px] text-violet-600 font-bold space-y-1 ml-2">
              <li>· 사업자등록번호 컬럼이 있는 모든 .xlsx 파일</li>
              <li>· 사업자등록번호 / 상호 중 하나 필수</li>
              <li>· 상호명, 업태, 종목, 대표자 컬럼 자동 인식</li>
              <li>· 여러 파일 동시 업로드 가능</li>
            </ul>
          </div>

          {/* 업로드 영역 */}
          <div
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
              dragging ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:border-violet-300"
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
                <p className="text-[10px] text-slate-300 mt-1">.xlsx 파일 지원 · 여러 파일 동시 가능</p>
              </>
            )}
          </div>

          {error && <p className="text-red-500 text-xs font-bold">⚠️ {error}</p>}

          {status && (
            <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-black text-green-700">✅ 업로드 완료</p>
              <div className="flex gap-3 flex-wrap">
                {status.files > 1 && (
                  <span className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-1 rounded-full">
                    📁 {status.files}개 파일
                  </span>
                )}
                <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                  ✅ {status.count}건 추가
                </span>
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
