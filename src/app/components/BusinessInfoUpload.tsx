"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

interface BusinessInfoEntry {
  b_no: string;
  b_nm?: string;
  p_nm?: string;
  biz_type?: string;
  b_sector?: string;
  b_type?: string;
}

type FileType = "card_nts" | "card_nts_detail" | "cash_nts" | "biz_reg" | "unknown";

// ============================================================
// 파일명에서 날짜 숫자 추출 (YYYYMMDD 기준, 8자리 최대값)
// 예) "거래처등록_20260419.xlsx" → 20260419
//     "사업용신용카드_...20260419145959..." → 20260419
// ============================================================
function extractFileDateNum(filename: string): number {
  const matches = filename.match(/\d{8,}/g);
  if (!matches) return 0;
  return Math.max(...matches.map((m) => parseInt(m.slice(0, 8), 10)));
}

// ============================================================
// 파일 형식 감지 (첫 5행 스캔)
// ============================================================
function detectFileType(rawRows: string[][]): FileType {
  for (const row of rawRows.slice(0, 5)) {
    const cells = row.map((c) => String(c));
    if (cells.some((c) => c === "가맹점사업자번호" || c.includes("가맹점사업자번호"))) return "card_nts";
    if (cells.some((c) => c === "가맹점 사업자번호" || c.includes("가맹점 사업자번호"))) return "cash_nts";
    // 홈택스 사업용신용카드 거래내역 (거래처사업자등록번호 + 가맹점상호)
    if (cells.some((c) => c.includes("거래처사업자등록번호"))) return "card_nts_detail";
    if (
      cells.some((c) => c.includes("거래처명")) &&
      cells.some((c) => c.includes("사업자등록번호"))
    )
      return "biz_reg";
  }
  return "unknown";
}

// ============================================================
// 국세청 사업용신용카드 세액공제내역 파서 (card_nts)
// 헤더 행 자동 감지, 마지막 행이 최신
// ============================================================
function parseCardNtsRows(
  rawRows: string[][]
): BusinessInfoEntry[] {
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    if (
      rawRows[i].some((c) => String(c).includes("가맹점사업자번호"))
    ) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) return [];

  const headers = rawRows[headerRowIdx].map((h) => String(h).trim());
  const dataRows = rawRows.slice(headerRowIdx + 1);

  const idx = (name: string) => headers.indexOf(name);
  const colBno = idx("가맹점사업자번호");
  const colNm = idx("가맹점명");
  const colBizType = idx("가맹점유형");
  const colSector = idx("업태");
  const colType = idx("업종");

  if (colBno === -1) return [];

  const map: Record<string, BusinessInfoEntry> = {};
  for (const row of dataRows) {
    const bnoRaw = String(row[colBno] ?? "").replace(/[^0-9]/g, "");
    if (bnoRaw.length !== 10) continue;
    // 마지막 행이 최신 → 항상 덮어쓰기
    map[bnoRaw] = {
      b_no: bnoRaw,
      b_nm: colNm >= 0 ? String(row[colNm] ?? "").trim() || undefined : undefined,
      biz_type: colBizType >= 0 ? String(row[colBizType] ?? "").trim() || undefined : undefined,
      b_sector: colSector >= 0 ? String(row[colSector] ?? "").trim() || undefined : undefined,
      b_type: colType >= 0 ? String(row[colType] ?? "").trim() || undefined : undefined,
    };
  }
  return Object.values(map);
}

// ============================================================
// 국세청 현금영수증 세액공제내역 파서 (cash_nts)
// 컬럼: 가맹점명, 가맹점 사업자번호(공백 있음), 가맹점유형, 가맹점업종
// ============================================================
function parseCashNtsRows(rawRows: string[][]): BusinessInfoEntry[] {
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    if (rawRows[i].some((c) => String(c).includes("가맹점 사업자번호"))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) return [];

  const headers = rawRows[headerRowIdx].map((h) => String(h).trim());
  const dataRows = rawRows.slice(headerRowIdx + 1);

  const idx = (name: string) => headers.indexOf(name);
  const colBno = idx("가맹점 사업자번호");
  const colNm = idx("가맹점명");
  const colBizType = idx("가맹점유형");
  const colType = idx("가맹점업종");

  if (colBno === -1) return [];

  const map: Record<string, BusinessInfoEntry> = {};
  for (const row of dataRows) {
    const bnoRaw = String(row[colBno] ?? "").replace(/[^0-9]/g, "");
    if (bnoRaw.length !== 10) continue;
    map[bnoRaw] = {
      b_no: bnoRaw,
      b_nm: colNm >= 0 ? String(row[colNm] ?? "").trim() || undefined : undefined,
      biz_type: colBizType >= 0 ? String(row[colBizType] ?? "").trim() || undefined : undefined,
      b_type: colType >= 0 ? String(row[colType] ?? "").trim() || undefined : undefined,
    };
  }
  return Object.values(map);
}

// ============================================================
// 홈택스 사업용신용카드 거래내역 파서 (card_nts_detail)
// 컬럼: 거래처사업자등록번호, 가맹점상호
// ============================================================
function parseCardNtsDetailRows(rawRows: string[][]): BusinessInfoEntry[] {
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    if (rawRows[i].some((c) => String(c).includes("거래처사업자등록번호"))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) return [];

  const headers = rawRows[headerRowIdx].map((h) => String(h).trim());
  const dataRows = rawRows.slice(headerRowIdx + 1);

  const idx = (name: string) => headers.indexOf(name);
  const colBno = idx("거래처사업자등록번호");
  const colNm = idx("가맹점상호");

  if (colBno === -1) return [];

  const map: Record<string, BusinessInfoEntry> = {};
  for (const row of dataRows) {
    const bnoRaw = String(row[colBno] ?? "").replace(/[^0-9]/g, "");
    if (bnoRaw.length !== 10) continue;
    map[bnoRaw] = {
      b_no: bnoRaw,
      b_nm: colNm >= 0 ? String(row[colNm] ?? "").trim() || undefined : undefined,
    };
  }
  return Object.values(map);
}

// ============================================================
// 거래처등록 파서 (biz_reg)
// b_no: 행 내 10자리 숫자 셀 탐색
// b_nm: "거래처명" 컬럼, p_nm: "대표자" 컬럼
// ============================================================
function parseBizRegRows(
  rawRows: string[][]
): BusinessInfoEntry[] {
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    const row = rawRows[i];
    if (
      row.some((c) => String(c).includes("거래처명")) &&
      row.some((c) => String(c).includes("사업자등록번호"))
    ) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) return [];

  const headers = rawRows[headerRowIdx].map((h) => String(h).trim());
  const dataRows = rawRows.slice(headerRowIdx + 1);

  const colNm = headers.indexOf("거래처명");
  const colRep = headers.indexOf("대표자");

  const map: Record<string, BusinessInfoEntry> = {};
  for (const row of dataRows) {
    // b_no: 행 내 임의 컬럼에서 10자리 숫자 탐색
    let b_no = "";
    for (const cell of row) {
      const digits = String(cell ?? "").replace(/[^0-9]/g, "");
      if (digits.length === 10) { b_no = digits; break; }
    }
    if (!b_no) continue;

    // 마지막 행이 최신 → 항상 덮어쓰기
    map[b_no] = {
      b_no,
      b_nm: colNm >= 0 ? String(row[colNm] ?? "").trim() || undefined : undefined,
      p_nm: colRep >= 0 ? String(row[colRep] ?? "").trim() || undefined : undefined,
    };
  }
  return Object.values(map);
}

// ============================================================
// 파일 파싱 (형식 자동 감지)
// ============================================================
function parseFile(
  file: File
): Promise<{ type: FileType; entries: BusinessInfoEntry[]; dateNum: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];

        const type = detectFileType(rawRows);
        const dateNum = extractFileDateNum(file.name);

        let entries: BusinessInfoEntry[] = [];
        if (type === "card_nts") entries = parseCardNtsRows(rawRows);
        else if (type === "card_nts_detail") entries = parseCardNtsDetailRows(rawRows);
        else if (type === "cash_nts") entries = parseCashNtsRows(rawRows);
        else if (type === "biz_reg") entries = parseBizRegRows(rawRows);

        resolve({ type, entries, dateNum });
      } catch {
        reject(new Error(`${file.name}: 파일을 읽는 중 오류가 발생했습니다.`));
      }
    };
    reader.onerror = () => reject(new Error(`${file.name}: 파일 읽기에 실패했습니다.`));
    reader.readAsArrayBuffer(file);
  });
}

// ============================================================
// API helpers
// ============================================================
async function getBusinessInfoStats(): Promise<{ count: number }> {
  const res = await fetch("/api/db/stats?table=business_info");
  if (!res.ok) return { count: 0 };
  return res.json();
}

async function uploadBusinessInfo(businesses: BusinessInfoEntry[]) {
  const res = await fetch("/api/db/upload-business-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businesses }),
  });
  if (!res.ok) throw new Error("사업자DB 업로드 실패");
  return res.json() as Promise<{ count: number }>;
}

// ============================================================
// Main Component
// ============================================================
export default function BusinessInfoUpload({ onBack }: { onBack: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [dbCount, setDbCount] = useState(0);
  const [status, setStatus] = useState<{
    count: number;
    files: number;
    bizRegCount: number;
    cardNtsCount: number;
    cashNtsCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBusinessInfoStats().then((s) => setDbCount(s.count || 0)).catch(() => {});
  }, []);

  const handleFiles = async (fileList: FileList) => {
    const files = Array.from(fileList).filter((f) => f.name.match(/\.xlsx?$|\.xls$/i));
    if (files.length === 0) { setError("xlsx / xls 파일만 업로드 가능합니다."); return; }
    setLoading(true); setError(""); setStatus(null);

    try {
      const parsed = await Promise.all(files.map(parseFile));

      // 파일 유형 분리 후 날짜 오름차순 정렬 (오래된 파일 먼저, 최신이 덮어씀)
      const bizRegFiles = parsed
        .filter((p) => p.type === "biz_reg")
        .sort((a, b) => a.dateNum - b.dateNum);
      // card_nts + cash_nts 합산 후 날짜순 정렬 (서로 보완적으로 병합)
      const ntsFiles = parsed
        .filter((p) => p.type === "card_nts" || p.type === "card_nts_detail" || p.type === "cash_nts")
        .sort((a, b) => a.dateNum - b.dateNum);

      if (bizRegFiles.length === 0 && ntsFiles.length === 0) {
        setError("지원 형식을 찾지 못했습니다. (거래처등록 / 사업용신용카드 세액공제내역·거래내역 / 현금영수증 세액공제내역 파일이 필요합니다.)");
        return;
      }

      // ── 병합: 거래처등록(기초) → 국세청 파일들(덮어씀, undefined는 기존 값 보존) ──
      const mergedMap: Record<string, BusinessInfoEntry> = {};

      for (const { entries } of bizRegFiles) {
        for (const e of entries) {
          mergedMap[e.b_no] = { ...mergedMap[e.b_no], ...e };
        }
      }

      for (const { entries } of ntsFiles) {
        for (const e of entries) {
          const ex = mergedMap[e.b_no];
          mergedMap[e.b_no] = {
            b_no: e.b_no,
            b_nm: e.b_nm ?? ex?.b_nm,
            p_nm: e.p_nm ?? ex?.p_nm,
            biz_type: e.biz_type ?? ex?.biz_type,
            b_sector: e.b_sector ?? ex?.b_sector,
            b_type: e.b_type ?? ex?.b_type,
          };
        }
      }

      const merged = Object.values(mergedMap);
      if (merged.length === 0) { setError("유효한 사업자번호 데이터를 찾을 수 없습니다."); return; }

      const [result, stats] = await Promise.all([
        uploadBusinessInfo(merged),
        getBusinessInfoStats(),
      ]);
      setStatus({
        count: result.count,
        files: files.length,
        bizRegCount: bizRegFiles.reduce((s, f) => s + f.entries.length, 0),
        cardNtsCount: parsed.filter((p) => p.type === "card_nts").reduce((s, f) => s + f.entries.length, 0),
        cashNtsCount: parsed.filter((p) => p.type === "cash_nts").reduce((s, f) => s + f.entries.length, 0),
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
        <div className="bg-violet-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">사업자DB 관리</h1>
          <p className="text-violet-200 text-xs font-bold uppercase tracking-widest opacity-80">
            Business Info Database Upload
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* 현재 DB 현황 */}
          <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-2xl">🏢</span>
            <div>
              <p className="text-xs font-bold text-slate-400">현재 저장된 사업자</p>
              <p className="text-2xl font-black text-slate-800">
                {dbCount.toLocaleString()}
                <span className="text-sm font-bold text-slate-400 ml-1">개</span>
              </p>
            </div>
          </div>

          {/* 안내 */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-black text-violet-700">📋 지원 파일 형식</p>
            <ul className="text-[11px] text-violet-600 font-bold space-y-1 ml-2">
              <li>· 거래처등록 .xlsx — 기초 데이터 (거래처명·대표자)</li>
              <li>· 국세청 사업용신용카드 세액공제내역·거래내역 .xls — 덮어쓰기 (업태·업종 추가)</li>
              <li>· 국세청 현금영수증 세액공제내역 .xls — 덮어쓰기 (유형·업종 추가)</li>
              <li>· 동일 사업자번호: 파일명 날짜 기준 최신 데이터 반영</li>
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
                <div className="text-4xl mb-3">🏢</div>
                <p className="text-sm font-bold text-slate-500">클릭하거나 파일을 여기에 끌어다 놓으세요</p>
                <p className="text-[10px] text-slate-300 mt-1">.xls / .xlsx 파일 지원 · 여러 파일 동시 가능</p>
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
                {status.bizRegCount > 0 && (
                  <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">
                    📋 거래처등록 {status.bizRegCount}건
                  </span>
                )}
                {status.cardNtsCount > 0 && (
                  <span className="bg-violet-100 text-violet-700 text-xs font-bold px-3 py-1 rounded-full">
                    💳 카드내역 {status.cardNtsCount}건
                  </span>
                )}
                {status.cashNtsCount > 0 && (
                  <span className="bg-teal-100 text-teal-700 text-xs font-bold px-3 py-1 rounded-full">
                    🧾 현금영수증 {status.cashNtsCount}건
                  </span>
                )}
                <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                  🏢 최종 {status.count}건 저장
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
