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

// 업종 조회 결과 (DB or 네이버)
interface BusinessInfo {
  sector: string;   // 업태
  type: string;     // 종목
  source: "db" | "naver" | "";
}

interface ManualOverride {
  code: string;
  name: string;
  tag: string;
}

interface ClassifiedCashRow {
  input: CashReceiptRow;
  result: ClassificationResult;
  bizInfo: BusinessInfo;
  original차변: string;
  changed: boolean;
  manualOverride?: ManualOverride;
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

// 코드 → 계정과목명 매핑 (530/630/730 포함)
const CODE_TO_ACCOUNT: Record<string, { name: string; tag: string }> = {
  "530": { name: "소모품비", tag: "매입" },
  "630": { name: "소모품비", tag: "매입" },
  "730": { name: "소모품비", tag: "매입" },
  "801": { name: "임원급여", tag: "" },
  "802": { name: "직원급여", tag: "" },
  "803": { name: "상여금", tag: "" },
  "811": { name: "복리후생비", tag: "매입" },
  "812": { name: "여비교통비", tag: "매입" },
  "813": { name: "접대비", tag: "일반" },
  "814": { name: "통신비", tag: "매입" },
  "815": { name: "수도광열비", tag: "매입" },
  "816": { name: "전력비", tag: "매입" },
  "817": { name: "세금과공과금", tag: "일반" },
  "818": { name: "감가상각비", tag: "일반" },
  "819": { name: "지급임차료", tag: "매입" },
  "820": { name: "수선비", tag: "매입" },
  "821": { name: "보험료", tag: "일반" },
  "822": { name: "차량유지비", tag: "매입" },
  "823": { name: "경상연구개발비", tag: "매입" },
  "824": { name: "운반비", tag: "매입" },
  "825": { name: "교육훈련비", tag: "매입" },
  "826": { name: "도서인쇄비", tag: "매입" },
  "827": { name: "회의비", tag: "매입" },
  "828": { name: "포장비", tag: "매입" },
  "829": { name: "사무용품비", tag: "매입" },
  "830": { name: "소모품비", tag: "매입" },
  "831": { name: "지급수수료", tag: "매입" },
  "832": { name: "보관료", tag: "매입" },
  "833": { name: "광고선전비", tag: "매입" },
  "834": { name: "판매촉진비", tag: "매입" },
  "835": { name: "대손상각비", tag: "일반" },
  "837": { name: "건물관리비", tag: "매입" },
};

// 계정과목명 → 코드 매핑 (소모품비 제외 — 피커로 처리)
const NAME_TO_CODE: Record<string, string> = {
  "복리후생비": "811", "여비교통비": "812", "접대비": "813",
  "통신비": "814", "수도광열비": "815", "전력비": "816",
  "세금과공과금": "817", "감가상각비": "818", "지급임차료": "819",
  "수선비": "820", "보험료": "821", "차량유지비": "822",
  "경상연구개발비": "823", "운반비": "824", "교육훈련비": "825",
  "도서인쇄비": "826", "회의비": "827", "포장비": "828",
  "사무용품비": "829", "지급수수료": "831", "보관료": "832",
  "광고선전비": "833", "판매촉진비": "834", "대손상각비": "835",
  "건물관리비": "837", "임원급여": "801", "직원급여": "802",
  "상여금": "803",
};

// 소모품 코드 보기
const SOMOUM_CODES = [
  { code: "530", desc: "제조원가" },
  { code: "630", desc: "공사원가" },
  { code: "730", desc: "기타원가" },
  { code: "830", desc: "판관비(일반)" },
];

// 입력값 파싱: 코드(숫자) or 계정과목명
function resolveAccountInput(input: string): { code: string; name: string; needsSomoumPicker: boolean } | null {
  const v = input.trim();
  if (/^\d{3}$/.test(v)) {
    const found = CODE_TO_ACCOUNT[v];
    if (found) return { code: v, name: found.name, needsSomoumPicker: false };
  }
  if (v.includes("소모품")) {
    return { code: "", name: "소모품비", needsSomoumPicker: true };
  }
  const code = NAME_TO_CODE[v];
  if (code) return { code, name: v, needsSomoumPicker: false };
  return null;
}

function getEffectiveResult(c: ClassifiedCashRow): ClassificationResult {
  if (c.manualOverride) {
    return { ...c.result, code: c.manualOverride.code, name: c.manualOverride.name, tag: c.manualOverride.tag };
  }
  return c.result;
}

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
// 거래처명 정규화
// ============================================================
const CORP_PATTERN = /(주식회사|유한회사|유한책임회사|（주）|\(주\)|㈜|농업회사법인|어업회사법인|영농조합법인|사회적협동조합|\(|\)|\s)/g;

function normalizeName(name: string): string {
  return name.replace(CORP_PATTERN, "").toLowerCase();
}

function isNameMatch(title: string, query: string): boolean {
  const t = normalizeName(title);
  const q = normalizeName(query);
  if (!t || !q) return false;
  // 정확히 같거나, 한쪽이 다른쪽을 포함하면 매칭
  return t === q || t.includes(q) || q.includes(t);
}

function cleanCorpName(name: string): string {
  return name.replace(CORP_PATTERN, "").trim();
}

// ============================================================
// DB 조회 — 사업자번호(10자리) 또는 거래처명으로 검색
// ============================================================
async function searchDbByBno(bno: string): Promise<BusinessInfo | null> {
  if (!bno || bno.replace(/[^0-9]/g, "").length !== 10) return null;
  try {
    const cleaned = bno.replace(/[^0-9]/g, "");
    const res = await fetch(`/api/db/search?bno=${encodeURIComponent(cleaned)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d) return null;
    if (!d.b_sector && !d.b_type) return null;
    return { sector: d.b_sector || "", type: d.b_type || "", source: "db" };
  } catch {
    return null;
  }
}

async function searchDbByName(tradeName: string): Promise<BusinessInfo | null> {
  try {
    const res = await fetch(`/api/db/search?name=${encodeURIComponent(tradeName)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d) return null;
    if (!d.b_sector && !d.b_type) return null;
    return { sector: d.b_sector || "", type: d.b_type || "", source: "db" };
  } catch {
    return null;
  }
}

// ============================================================
// 네이버 검색 — 법인접미사 제거 후 검색, 상위 3개 매칭 검증
// ============================================================
async function searchNaverBizInfo(tradeName: string): Promise<BusinessInfo | null> {
  try {
    const cleaned = cleanCorpName(tradeName);
    if (!cleaned) return null;
    const res = await fetch(`/api/naver/search?q=${encodeURIComponent(cleaned)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const items = (data.items || []).slice(0, 3);

    for (const item of items) {
      if (isNameMatch(item.title, cleaned)) {
        return { sector: item.category || "", type: "", source: "naver" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 거래처 업종 조회: DB 우선 → 네이버 폴백
// ============================================================
async function lookupBusinessInfo(tradeName: string, code: string): Promise<BusinessInfo> {
  // 1. Code가 사업자번호(10자리)이면 DB 조회
  const dbByBno = await searchDbByBno(code);
  if (dbByBno) return dbByBno;

  // 2. 거래처명으로 DB 검색
  const dbByName = await searchDbByName(tradeName);
  if (dbByName) return dbByName;

  // 3. 네이버 검색 폴백
  const naver = await searchNaverBizInfo(tradeName);
  if (naver) return naver;

  return { sector: "", type: "", source: "" };
}

// ============================================================
// 분류 (DB/네이버 업종 정보 → classifyTransaction 활용)
// ============================================================
function classifyCashReceipt(
  row: CashReceiptRow,
  bizInfo: BusinessInfo,
  conditions: BusinessConditions
): ClassificationResult {
  // classifyTransaction에 업태/종목 정보 전달
  const txRow: TransactionRow = {
    tradeName: row.거래처,
    businessType: bizInfo.sector,
    sector: bizInfo.type,
    amount: row.합계,
    ntsStatus: row.국세청,
    taxType: row.유형,
  };

  const result = classifyTransaction(txRow, conditions);

  if (result.confidence !== "low") {
    return result;
  }

  // 네이버 카테고리로 추가 분류 시도
  if (bizInfo.sector) {
    const category = classifyBusiness(bizInfo.sector);
    if (category.label !== "일반사업체") {
      const catAccount = CATEGORY_ACCOUNT_MAP[category.label];
      if (catAccount) {
        return {
          code: catAccount.code,
          name: catAccount.name,
          tag: catAccount.tag,
          confidence: "medium",
          note: `${bizInfo.source === "db" ? "DB" : "네이버"}: ${bizInfo.sector}`,
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

  for (const row of classified) {
    const { input, result, manualOverride } = row;
    const eff = manualOverride ? { ...result, ...manualOverride } : result;
    const debitName = eff.tag === "전송제외"
      ? ""
      : eff.name
        ? `(판)${eff.name.replace("(기업업무추진비)", "")}`
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

  // 정렬
  const [sortConfig, setSortConfig] = useState<{ field: "code" | "name"; dir: "asc" | "desc" } | null>(null);

  // 인라인 편집
  const [editingCell, setEditingCell] = useState<{ origIdx: number; field: "account" | "tag" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [somoumPicker, setSomoumPicker] = useState<number | null>(null); // origIdx

  // 업종 조회 캐시 (거래처명 → BusinessInfo)
  const bizCacheRef = useRef<Map<string, BusinessInfo>>(new Map());

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

      // 고유 거래처명 + Code 매핑
      const uniqueEntries = new Map<string, string>();
      for (const r of rows) {
        if (!uniqueEntries.has(r.거래처)) {
          uniqueEntries.set(r.거래처, r.Code);
        }
      }
      const uniqueNames = [...uniqueEntries.keys()];
      const cache = bizCacheRef.current;

      const uncached = uniqueNames.filter((n) => !cache.has(n));
      setProgress({ current: 0, total: uncached.length });

      // DB/네이버 순차 조회 (5개씩 병렬)
      for (let i = 0; i < uncached.length; i += 5) {
        const batch = uncached.slice(i, i + 5);
        const results = await Promise.all(
          batch.map((name) => lookupBusinessInfo(name, uniqueEntries.get(name) || ""))
        );
        batch.forEach((name, idx) => {
          cache.set(name, results[idx]);
        });
        setProgress({ current: Math.min(i + 5, uncached.length), total: uncached.length });
      }

      // 분류 실행
      const classifiedRows: ClassifiedCashRow[] = rows.map((input) => {
        const bizInfo = cache.get(input.거래처) || { sector: "", type: "", source: "" as const };
        const result = classifyCashReceipt(input, bizInfo, conditions);
        const changed = validateExisting(input, result);
        return {
          input,
          result,
          bizInfo,
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
      const bizInfo = bizCacheRef.current.get(c.input.거래처) || { sector: "", type: "", source: "" as const };
      const result = classifyCashReceipt(c.input, bizInfo, conditions);
      const changed = validateExisting(c.input, result);
      return { ...c, result, bizInfo, changed };
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

  const filteredRows = (() => {
    let rows = classified.filter((c) => {
      const eff = getEffectiveResult(c);
      if (filter === "changed") return c.changed || !!c.manualOverride;
      if (filter === "review") return c.result.confidence === "low" && !c.manualOverride;
      if (filter === "exclude") return eff.tag === "전송제외";
      return true;
    });
    if (sortConfig) {
      rows = [...rows].sort((a, b) => {
        const va = getEffectiveResult(a)[sortConfig.field === "code" ? "code" : "name"] || "";
        const vb = getEffectiveResult(b)[sortConfig.field === "code" ? "code" : "name"] || "";
        const cmp = va.localeCompare(vb, "ko");
        return sortConfig.dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  })();

  // 정렬 토글
  const toggleSort = (field: "code" | "name") => {
    setSortConfig((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "asc" };
      if (prev.dir === "asc") return { field, dir: "desc" };
      return null;
    });
  };

  // 계정과목 편집 확정
  const commitAccountEdit = (origIdx: number, value: string) => {
    const parsed = resolveAccountInput(value);
    if (!parsed) { setEditingCell(null); setSomoumPicker(null); return; }
    if (parsed.needsSomoumPicker) { setSomoumPicker(origIdx); return; }
    applyOverride(origIdx, parsed.code, parsed.name);
  };

  // 소모품 코드 선택
  const applyOverride = (origIdx: number, code: string, name: string) => {
    const defaultTag = CODE_TO_ACCOUNT[code]?.tag ?? "매입";
    setClassified((prev) => prev.map((c, i) => {
      if (i !== origIdx) return c;
      const currentTag = c.manualOverride?.tag ?? c.result.tag;
      return { ...c, manualOverride: { code, name, tag: currentTag || defaultTag }, changed: true };
    }));
    setEditingCell(null);
    setSomoumPicker(null);
    setEditValue("");
  };

  // 태그(구분) 편집
  const applyTagOverride = (origIdx: number, tag: string) => {
    setClassified((prev) => prev.map((c, i) => {
      if (i !== origIdx) return c;
      const eff = getEffectiveResult(c);
      return { ...c, manualOverride: { code: eff.code, name: eff.name, tag }, changed: true };
    }));
    setEditingCell(null);
  };

  return (
    <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-400 font-bold text-[10px] uppercase sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left w-8">#</th>
                        <th className="p-2 text-left">일자</th>
                        <th className="p-2 text-left">거래처</th>
                        <th className="p-2 text-right">합계</th>
                        <th className="p-2 text-left">기존 차변</th>
                        <th className="p-2 text-center">→</th>
                        <th
                          className="p-2 text-left cursor-pointer select-none hover:text-blue-500 transition-colors"
                          onClick={() => toggleSort("code")}
                        >
                          분류결과{" "}
                          {sortConfig?.field === "code"
                            ? sortConfig.dir === "asc" ? "▲" : "▼"
                            : <span className="opacity-30">⇅</span>}
                        </th>
                        <th
                          className="p-2 text-center cursor-pointer select-none hover:text-blue-500 transition-colors"
                          onClick={() => toggleSort("name")}
                        >
                          구분{" "}
                          {sortConfig?.field === "name"
                            ? sortConfig.dir === "asc" ? "▲" : "▼"
                            : <span className="opacity-30">⇅</span>}
                        </th>
                        <th className="p-2 text-left">업종(DB/네이버)</th>
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {filteredRows.map((c, i) => {
                        const origIdx = classified.indexOf(c);
                        const eff = getEffectiveResult(c);
                        const isLow = c.result.confidence === "low" && !c.manualOverride;
                        const isExclude = eff.tag === "전송제외";
                        const rowBg = isLow
                          ? "bg-red-50"
                          : (c.changed || c.manualOverride)
                          ? "bg-orange-50"
                          : isExclude
                          ? "bg-slate-50"
                          : "";
                        const tagColor =
                          eff.tag === "매입" ? "bg-purple-100 text-purple-700"
                          : eff.tag === "일반" ? "bg-slate-100 text-slate-600"
                          : eff.tag === "전송제외" ? "bg-red-100 text-red-600"
                          : "bg-slate-100 text-slate-500";
                        const confIcon = c.manualOverride ? "✎"
                          : c.result.confidence === "high" ? "●"
                          : c.result.confidence === "medium" ? "◐"
                          : "○";
                        const confColor = c.manualOverride ? "text-blue-500"
                          : c.result.confidence === "high" ? "text-green-500"
                          : c.result.confidence === "medium" ? "text-amber-500"
                          : "text-red-500";

                        const isEditingAccount = editingCell?.origIdx === origIdx && editingCell?.field === "account";
                        const isEditingTag = editingCell?.origIdx === origIdx && editingCell?.field === "tag";
                        const isShowingSomoum = somoumPicker === origIdx;

                        return (
                          <tr key={i} className={`border-t border-slate-50 ${rowBg}`}>
                            <td className="p-2 text-slate-300">{origIdx + 1}</td>
                            <td className="p-2 text-slate-500 whitespace-nowrap">{c.input.일자}</td>
                            <td className="p-2 max-w-[140px] truncate">{c.input.거래처}</td>
                            <td className="p-2 text-right text-slate-500 whitespace-nowrap">
                              {c.input.합계.toLocaleString()}
                            </td>
                            <td className="p-2 text-slate-400 max-w-[100px] truncate">
                              {c.original차변 || "-"}
                            </td>
                            <td className="p-2 text-center">
                              {(c.changed || c.manualOverride) ? (
                                <span className="text-orange-500 font-black">→</span>
                              ) : (
                                <span className="text-green-400">=</span>
                              )}
                            </td>
                            {/* 계정과목 편집 셀 */}
                            <td className="p-2 relative">
                              {isEditingAccount ? (
                                <div className="flex flex-col gap-1">
                                  <input
                                    autoFocus
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitAccountEdit(origIdx, editValue);
                                      if (e.key === "Escape") { setEditingCell(null); setSomoumPicker(null); }
                                    }}
                                    placeholder="코드(830) 또는 계정과목명"
                                    className="w-full px-2 py-1 border border-blue-400 rounded text-[10px] font-bold outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                                  />
                                  {isShowingSomoum && (
                                    <div className="absolute top-full left-0 z-20 bg-white border border-blue-200 rounded-xl shadow-lg p-2 flex gap-1 flex-wrap">
                                      <p className="w-full text-[9px] text-slate-400 font-bold mb-1">소모품비 코드 선택:</p>
                                      {SOMOUM_CODES.map(({ code, desc }) => (
                                        <button
                                          key={code}
                                          onClick={() => applyOverride(origIdx, code, "소모품비")}
                                          className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[10px] font-black transition-colors"
                                        >
                                          {code} <span className="font-normal text-slate-500">{desc}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => commitAccountEdit(origIdx, editValue)}
                                      className="flex-1 px-1 py-0.5 bg-blue-500 text-white rounded text-[9px] font-bold"
                                    >확인</button>
                                    <button
                                      onClick={() => { setEditingCell(null); setSomoumPicker(null); setEditValue(""); }}
                                      className="flex-1 px-1 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold"
                                    >취소</button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingCell({ origIdx, field: "account" });
                                    setEditValue("");
                                    setSomoumPicker(null);
                                  }}
                                  className="w-full text-left group"
                                >
                                  <span className={confColor}>{confIcon}</span>{" "}
                                  {eff.code ? `${eff.code} ` : ""}
                                  {eff.name || "-"}
                                  {c.manualOverride && (
                                    <span className="ml-1 text-[8px] text-blue-400 font-bold">[수기]</span>
                                  )}
                                  <span className="ml-1 text-[8px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                                  {!c.manualOverride && c.result.note && (
                                    <span className="block text-[9px] text-slate-400 font-normal truncate max-w-[120px]">
                                      {c.result.note}
                                    </span>
                                  )}
                                </button>
                              )}
                            </td>
                            {/* 구분(태그) 편집 셀 */}
                            <td className="p-2 text-center relative">
                              {isEditingTag ? (
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 bg-white border border-blue-200 rounded-xl shadow-lg p-1 flex flex-col gap-0.5 min-w-[80px]">
                                  {["매입", "일반", "전송제외"].map((tag) => (
                                    <button
                                      key={tag}
                                      onClick={() => applyTagOverride(origIdx, tag)}
                                      className={`px-2 py-1 rounded text-[10px] font-bold text-left transition-colors ${
                                        tag === "매입" ? "hover:bg-purple-100 text-purple-700"
                                        : tag === "일반" ? "hover:bg-slate-100 text-slate-600"
                                        : "hover:bg-red-100 text-red-600"
                                      }`}
                                    >{tag}</button>
                                  ))}
                                  <button
                                    onClick={() => setEditingCell(null)}
                                    className="px-2 py-0.5 text-[9px] text-slate-400 hover:text-slate-600"
                                  >취소</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setEditingCell({ origIdx, field: "tag" }); setSomoumPicker(null); }}
                                  className="group"
                                >
                                  {eff.tag ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${tagColor} group-hover:opacity-80 transition-opacity`}>
                                      {eff.tag}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 text-[9px]">-</span>
                                  )}
                                  {c.manualOverride?.tag && (
                                    <span className="ml-0.5 text-[7px] text-blue-400">[수]</span>
                                  )}
                                </button>
                              )}
                            </td>
                            <td className="p-2 text-[10px] text-slate-400 max-w-[100px] truncate">
                              {c.bizInfo.sector ? `${c.bizInfo.source === "db" ? "[DB]" : ""} ${c.bizInfo.sector}` : "-"}
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
                <span className="flex items-center gap-1"><span className="text-blue-500">✎</span> 수기변경</span>
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
