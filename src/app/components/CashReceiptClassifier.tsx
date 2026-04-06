"use client";
import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  classifyTransaction,
  classifyBusiness,
  CATEGORY_ACCOUNT_MAP,
  type TransactionRow,
  type BusinessConditions,
  type ClassificationResult,
} from "@/lib/accountClassifier";

// ============================================================
// Types
// ============================================================
interface CashReceiptRow {
  연도: string;
  일자: string;
  Code: string;
  거래처: string;
  구분: string;
  품명: string;
  공급가액: number;
  세액: number;
  봉사료: number | null;
  합계: number;
  국세청: string;
  유형: string;
  차변계정: string;
  대변계정: string;
  관리: string;
  전표상태: string;
}

interface NaverResult {
  category: string;
  title: string;
}

interface ClassifiedCashRow {
  input: CashReceiptRow;
  result: ClassificationResult;
  naverCategory: string;
  original차변: string;
  changed: boolean;
}

// ============================================================
// Constants
// ============================================================
const CASH_RECEIPT_HEADERS = [
  "연도", "일자", "Code", "거래처", "구분", "품명", "공급가액", "세액",
  "봉사료", "합계", "국세청", "유형", "차변계정", "대변계정", "관리", "전표상태",
];

const BUSINESS_TYPE_OPTIONS = [
  { value: "그 외", label: "그 외" },
  { value: "도소매", label: "도소매" },
  { value: "음식점업", label: "음식점업" },
  { value: "건설업", label: "건설업" },
  { value: "제조업", label: "제조업" },
];

// ============================================================
// Helpers
// ============================================================
function parseCashReceiptExcel(buffer: ArrayBuffer): CashReceiptRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (raw.length < 2) return [];

  const headerRow = raw[0] as string[];
  const headerMatch = CASH_RECEIPT_HEADERS.every((h, i) => headerRow[i] === h);
  const dataStart = headerMatch ? 1 : 0;

  const rows: CashReceiptRow[] = [];
  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || r.length < 14) continue;
    if (!r[3]) continue;
    // 합계행 skip (거래처가 빈 문자열이거나 " 건" 포함)
    const tradeName = String(r[3] ?? "");
    if (!tradeName.trim() || tradeName.includes("건")) continue;

    rows.push({
      연도: String(r[0] ?? ""),
      일자: String(r[1] ?? ""),
      Code: String(r[2] ?? ""),
      거래처: tradeName,
      구분: String(r[4] ?? ""),
      품명: String(r[5] ?? ""),
      공급가액: Number(r[6]) || 0,
      세액: Number(r[7]) || 0,
      봉사료: r[8] != null ? Number(r[8]) : null,
      합계: Number(r[9]) || 0,
      국세청: String(r[10] ?? ""),
      유형: String(r[11] ?? ""),
      차변계정: String(r[12] ?? ""),
      대변계정: String(r[13] ?? ""),
      관리: String(r[14] ?? ""),
      전표상태: String(r[15] ?? ""),
    });
  }
  return rows;
}

// ============================================================
// 거래처명 정규화 (비교용)
// ============================================================
const CORP_SUFFIXES = /주식회사|（주）|\(주\)|㈜|유한회사|합자회사|합명회사/g;

function normalizeName(name: string): string {
  return name
    .replace(CORP_SUFFIXES, "")
    .replace(/[^가-힣a-zA-Z0-9]/g, "")
    .trim()
    .toLowerCase();
}

// 네이버 결과가 검색한 거래처와 실제로 같은 업체인지 판별
function isNameMatch(searchName: string, resultTitle: string): boolean {
  const normSearch = normalizeName(searchName);
  const normResult = normalizeName(resultTitle);

  if (!normSearch || !normResult) return false;

  // 정규화된 이름이 서로 포함관계이면 OK
  if (normResult.includes(normSearch) || normSearch.includes(normResult)) return true;

  // 검색명의 핵심 단어가 결과 제목의 시작 부분에 있는지 확인
  // (예: "쿠팡 제1물류점 CU" → 끝이 "CU"이므로 "쿠팡"과 무관)
  const searchCore = normSearch.replace(/페이|코리아|글로벌|인터내셔날|산업|식품|공장/g, "").trim();
  if (searchCore.length >= 2 && normResult.startsWith(searchCore)) return true;

  return false;
}

// ============================================================
// DB 조회 (사업자번호 없이 거래처명으로 — 향후 확장 가능)
// ============================================================
interface DbBusiness {
  b_no: string;
  b_nm: string;
  b_sector?: string;
  b_type?: string;
}

async function searchDb(tradeName: string): Promise<DbBusiness | null> {
  try {
    // DB에는 b_no 기반 검색밖에 없으므로, 거래처 Code가 있으면 활용
    // 현금영수증엔 사업자번호가 없으므로 null 반환 (DB API 확장 시 여기를 수정)
    return null;
  } catch {
    return null;
  }
}

// DB에 사업자번호로 조회
async function searchDbByBno(bno: string): Promise<DbBusiness | null> {
  if (!bno) return null;
  try {
    const res = await fetch(`/api/db/search?bno=${encodeURIComponent(bno)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

// ============================================================
// 네이버 검색 — 상위 3개 비교 후 매칭
// ============================================================
async function searchNaverCategory(tradeName: string): Promise<NaverResult | null> {
  try {
    const res = await fetch(`/api/naver/search?q=${encodeURIComponent(tradeName)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const items = (data.items || []).slice(0, 3); // 상위 3개만

    // 상위 3개 중 거래처명과 실제 매칭되는 첫 번째 결과 사용
    for (const item of items) {
      if (isNameMatch(tradeName, item.title)) {
        return { category: item.category, title: item.title };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 분류 (품명 무시, DB/네이버 카테고리 활용)
// ============================================================
function classifyCashReceipt(
  row: CashReceiptRow,
  naverCategory: string,
  conditions: BusinessConditions
): ClassificationResult {
  // classifyTransaction 로직 활용 (거래처명 + 네이버 카테고리 병합)
  const txRow: TransactionRow = {
    tradeName: row.거래처,
    businessType: naverCategory,
    sector: "",
    amount: row.합계,
    ntsStatus: row.국세청,
    taxType: row.유형,
  };

  const result = classifyTransaction(txRow, conditions);

  if (result.confidence !== "low") {
    return result;
  }

  // 네이버 카테고리로 추가 시도
  if (naverCategory) {
    const category = classifyBusiness(naverCategory);
    if (category.label !== "일반사업체") {
      const catAccount = CATEGORY_ACCOUNT_MAP[category.label];
      if (catAccount) {
        return {
          code: catAccount.code,
          name: catAccount.name,
          tag: catAccount.tag,
          confidence: "medium",
          note: `네이버: ${naverCategory}`,
        };
      }
    }
  }

  return result;
}

// 기존 차변계정과 우리 기준이 다른지 검증
function validateExisting(
  row: CashReceiptRow,
  newResult: ClassificationResult
): boolean {
  const existing = row.차변계정;
  if (!existing || existing === "미추천") return true;

  // (판) 접두사 제거 후 비교
  const cleanExisting = existing.replace(/^\(판\)/, "").trim();
  const cleanNew = newResult.name.replace(/^\(판\)/, "").replace("(기업업무추진비)", "").trim();

  return cleanExisting !== cleanNew;
}

// 엑셀 다운로드용 워크북 생성
function buildOutputWorkbook(classified: ClassifiedCashRow[]): XLSX.WorkBook {
  const outputRows: (string | number | null)[][] = [
    CASH_RECEIPT_HEADERS,
  ];

  for (const { input, result } of classified) {
    const debitName = result.tag === "전송제외"
      ? ""
      : result.name
        ? `(판)${result.name.replace("(기업업무추진비)", "")}`
        : input.차변계정;

    outputRows.push([
      input.연도,
      input.일자,
      input.Code,
      input.거래처,
      input.구분,
      input.품명,
      input.공급가액,
      input.세액,
      input.봉사료,
      input.합계,
      input.국세청,
      input.유형,
      debitName,
      input.대변계정,
      input.관리,
      input.전표상태,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(outputRows);
  ws["!cols"] = [
    { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 6 }, { wch: 30 },
    { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 },
    { wch: 8 }, { wch: 6 }, { wch: 20 }, { wch: 12 }, { wch: 6 }, { wch: 10 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "현금영수증 분류결과");
  return wb;
}

// ============================================================
// Component
// ============================================================
export default function CashReceiptClassifier({ onBack }: { onBack: () => void }) {
  const [conditions, setConditions] = useState<BusinessConditions>({
    hasEmployee: true,
    hasVehicle: false,
    isRefund: false,
    businessType: "그 외",
    isLargeCompany: false,
  });

  const [fileName, setFileName] = useState("");
  const [classified, setClassified] = useState<ClassifiedCashRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<"all" | "changed" | "review" | "exclude">("all");

  // 네이버 검색 캐시 (거래처명 → 카테고리)
  const naverCacheRef = useRef<Map<string, string>>(new Map());

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      setError("xlsx 파일만 업로드 가능합니다.");
      return;
    }
    setLoading(true);
    setError("");
    setClassified([]);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const rows = parseCashReceiptExcel(buffer);
      if (rows.length === 0) {
        setError("데이터를 찾을 수 없습니다. 파일 형식을 확인해주세요.");
        return;
      }

      // 고유 거래처명 + Code(사업자번호) 매핑
      const uniqueEntries = new Map<string, string>(); // 거래처명 → Code
      for (const r of rows) {
        if (!uniqueEntries.has(r.거래처)) {
          uniqueEntries.set(r.거래처, r.Code);
        }
      }
      const uniqueNames = [...uniqueEntries.keys()];
      const cache = naverCacheRef.current;

      const uncached = uniqueNames.filter((n) => !cache.has(n));
      setProgress({ current: 0, total: uncached.length });

      // 1단계: DB 우선 조회 (사업자번호가 있는 거래처)
      const dbBatch: string[] = [];
      for (const name of uncached) {
        const code = uniqueEntries.get(name) || "";
        if (code) {
          const dbResult = await searchDbByBno(code);
          if (dbResult && (dbResult.b_sector || dbResult.b_type)) {
            cache.set(name, [dbResult.b_sector, dbResult.b_type].filter(Boolean).join(">"));
            continue;
          }
        }
        dbBatch.push(name);
      }

      // 2단계: DB에 없는 거래처만 네이버 검색 (병렬 5개씩)
      for (let i = 0; i < dbBatch.length; i += 5) {
        const batch = dbBatch.slice(i, i + 5);
        const results = await Promise.all(batch.map(searchNaverCategory));
        batch.forEach((name, idx) => {
          const r = results[idx];
          cache.set(name, r?.category || "");
        });
        setProgress({ current: Math.min(i + 5, dbBatch.length), total: dbBatch.length });
      }

      // 분류 실행
      const classifiedRows: ClassifiedCashRow[] = rows.map((input) => {
        const naverCategory = cache.get(input.거래처) || "";
        const result = classifyCashReceipt(input, naverCategory, conditions);
        const changed = validateExisting(input, result);
        return {
          input,
          result,
          naverCategory,
          original차변: input.차변계정,
          changed,
        };
      });

      setClassified(classifiedRows);
    } catch {
      setError("파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [conditions]);

  const handleReClassify = () => {
    if (classified.length === 0) return;
    const results = classified.map((c) => {
      const naverCategory = naverCacheRef.current.get(c.input.거래처) || "";
      const result = classifyCashReceipt(c.input, naverCategory, conditions);
      const changed = validateExisting(c.input, result);
      return { ...c, result, changed };
    });
    setClassified(results);
  };

  const handleDownload = () => {
    if (classified.length === 0) return;
    const wb = buildOutputWorkbook(classified);
    XLSX.writeFile(wb, "현금영수증_계정분류결과.xls");
  };

  // 통계
  const total = classified.length;
  const highCount = classified.filter((c) => c.result.confidence === "high").length;
  const changedCount = classified.filter((c) => c.changed).length;
  const lowCount = classified.filter((c) => c.result.confidence === "low").length;
  const excludeCount = classified.filter((c) => c.result.tag === "전송제외").length;

  const filteredRows = classified.filter((c) => {
    if (filter === "changed") return c.changed;
    if (filter === "review") return c.result.confidence === "low";
    if (filter === "exclude") return c.result.tag === "전송제외";
    return true;
  });

  return (
    <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={onBack}
        className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors"
      >
        &#8592; 돌아가기
      </button>

      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <div className="bg-blue-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">현금영수증 계정과목 분류</h1>
          <p className="text-blue-100 text-xs font-bold uppercase tracking-widest opacity-80">
            Cash Receipt Account Classification
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* 사업 조건 설정 */}
          <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">&#9881;&#65039;</span>
              <span className="text-sm font-black text-slate-700">사업 조건 설정</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.hasEmployee}
                  onChange={(e) => setConditions((c) => ({ ...c, hasEmployee: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">4대보험 직원 있음</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.hasVehicle}
                  onChange={(e) => setConditions((c) => ({ ...c, hasVehicle: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">사업장 차량 등록</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.isRefund}
                  onChange={(e) => setConditions((c) => ({ ...c, isRefund: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">환급 신고</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.isLargeCompany}
                  onChange={(e) => setConditions((c) => ({ ...c, isLargeCompany: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">5인 이상 사업장</span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-400">업종</span>
              <select
                value={conditions.businessType}
                onChange={(e) => setConditions((c) => ({ ...c, businessType: e.target.value }))}
                className="flex-1 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400"
              >
                {BUSINESS_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {classified.length > 0 && (
                <button
                  onClick={handleReClassify}
                  className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-xl text-xs font-bold transition-colors"
                >
                  재분류
                </button>
              )}
            </div>
          </div>

          {/* 파일 업로드 */}
          <div
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
              dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-blue-300"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {loading ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-slate-500 font-bold text-sm">
                  <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  네이버 검색 중... ({progress.current}/{progress.total})
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="text-3xl mb-2">&#128203;</div>
                <p className="text-sm font-bold text-slate-500">
                  현금영수증(매입) 엑셀을 업로드하세요
                </p>
                <p className="text-[10px] text-slate-300 mt-1">
                  .xlsx 파일 지원 · 네이버 검색으로 업종 자동 조회
                </p>
                {fileName && (
                  <p className="text-[10px] text-blue-500 font-bold mt-2">현재 파일: {fileName}</p>
                )}
              </>
            )}
          </div>
          {error && <p className="text-red-500 text-xs font-bold">&#9888;&#65039; {error}</p>}

          {/* 분류 결과 */}
          {classified.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* 통계 */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setFilter("all")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "all" ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <p className="text-lg font-black">{total}</p>
                  <p className="text-[10px] font-bold opacity-70">전체</p>
                </button>
                <button
                  onClick={() => setFilter("changed")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "changed" ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-600 hover:bg-orange-100"
                  }`}
                >
                  <p className="text-lg font-black">{changedCount}</p>
                  <p className="text-[10px] font-bold opacity-70">변경됨</p>
                </button>
                <button
                  onClick={() => setFilter("review")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "review" ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-600 hover:bg-amber-100"
                  }`}
                >
                  <p className="text-lg font-black">{lowCount}</p>
                  <p className="text-[10px] font-bold opacity-70">확인필요</p>
                </button>
                <button
                  onClick={() => setFilter("exclude")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "exclude" ? "bg-red-500 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"
                  }`}
                >
                  <p className="text-lg font-black">{excludeCount}</p>
                  <p className="text-[10px] font-bold opacity-70">전송제외</p>
                </button>
              </div>

              {/* 테이블 */}
              <div className="border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-400 font-bold text-[10px] uppercase sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left w-8">#</th>
                        <th className="p-2 text-left">일자</th>
                        <th className="p-2 text-left">거래처</th>
                        <th className="p-2 text-right">합계</th>
                        <th className="p-2 text-left">기존 차변</th>
                        <th className="p-2 text-center">→</th>
                        <th className="p-2 text-left">분류 결과</th>
                        <th className="p-2 text-center">태그</th>
                        <th className="p-2 text-left">네이버 업종</th>
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {filteredRows.map((c, i) => {
                        const isLow = c.result.confidence === "low";
                        const isExclude = c.result.tag === "전송제외";
                        const rowBg = isLow
                          ? "bg-red-50"
                          : c.changed
                          ? "bg-orange-50"
                          : isExclude
                          ? "bg-slate-50"
                          : "";
                        const tagColor =
                          c.result.tag === "매입" ? "bg-purple-100 text-purple-700"
                          : c.result.tag === "일반" ? "bg-slate-100 text-slate-600"
                          : c.result.tag === "전송제외" ? "bg-red-100 text-red-600"
                          : "bg-slate-100 text-slate-500";
                        const confIcon =
                          c.result.confidence === "high" ? "●"
                          : c.result.confidence === "medium" ? "◐"
                          : "○";
                        const confColor =
                          c.result.confidence === "high" ? "text-green-500"
                          : c.result.confidence === "medium" ? "text-amber-500"
                          : "text-red-500";

                        return (
                          <tr key={i} className={`border-t border-slate-50 ${rowBg}`}>
                            <td className="p-2 text-slate-300">{classified.indexOf(c) + 1}</td>
                            <td className="p-2 text-slate-500 whitespace-nowrap">{c.input.일자}</td>
                            <td className="p-2 max-w-[140px] truncate">{c.input.거래처}</td>
                            <td className="p-2 text-right text-slate-500 whitespace-nowrap">
                              {c.input.합계.toLocaleString()}
                            </td>
                            <td className="p-2 text-slate-400 max-w-[100px] truncate">
                              {c.original차변 || "-"}
                            </td>
                            <td className="p-2 text-center">
                              {c.changed ? (
                                <span className="text-orange-500 font-black">→</span>
                              ) : (
                                <span className="text-green-400">=</span>
                              )}
                            </td>
                            <td className="p-2">
                              <span className={confColor}>{confIcon}</span>{" "}
                              {c.result.code ? `${c.result.code} ` : ""}
                              {c.result.name || "-"}
                              {c.result.note && (
                                <span className="block text-[9px] text-slate-400 font-normal truncate max-w-[120px]">
                                  {c.result.note}
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              {c.result.tag && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${tagColor}`}>
                                  {c.result.tag}
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-[10px] text-slate-400 max-w-[100px] truncate">
                              {c.naverCategory || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 범례 */}
              <div className="flex gap-3 text-[10px] text-slate-400 font-bold justify-center flex-wrap">
                <span className="flex items-center gap-1"><span className="text-green-500">●</span> PDF규칙</span>
                <span className="flex items-center gap-1"><span className="text-amber-500">◐</span> 카테고리추정</span>
                <span className="flex items-center gap-1"><span className="text-red-500">○</span> 미분류</span>
                <span className="flex items-center gap-1"><span className="text-orange-500 font-black">→</span> 변경됨</span>
                <span className="flex items-center gap-1"><span className="text-green-400">=</span> 유지</span>
              </div>

              {/* 다운로드 */}
              <button
                onClick={handleDownload}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-sm shadow-lg transition-all active:scale-95"
              >
                &#128229; 분류 결과 다운로드 (.xls)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
