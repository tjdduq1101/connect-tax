"use client";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  classifyTransaction,
  classifyBusiness,
  convertNotionRules,
  CATEGORY_ACCOUNT_MAP,
  CODE_TO_ACCOUNT,
  type TransactionRow,
  type BusinessConditions,
  type ClassificationResult,
  type MatchingRule,
} from "@/lib/accountClassifier";
import AccountAutocomplete from "./AccountAutocomplete";

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

// 업종 조회 결과 (DB or 네이버)
interface BusinessInfo {
  sector: string;   // 업태
  type: string;     // 종목
  source: "db" | "public" | "naver" | "";
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

interface HistoryEntry {
  id: string;
  fileName: string;
  savedAt: string;
  count: number;
  classified: ClassifiedCashRow[];
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

// 코드↔계정과목명 매칭 및 추천은 AccountAutocomplete + accountMaster가 담당.

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
// 공공데이터 조회 — 금융위원회 + 국민연금
// ============================================================
async function searchPublicDataBizInfo(bno: string): Promise<BusinessInfo | null> {
  const cleaned = bno.replace(/[^0-9]/g, "");
  if (cleaned.length !== 10) return null;
  try {
    const res = await fetch(`/api/data-go-kr/business-info?bno=${encodeURIComponent(cleaned)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d || !d.b_nm) return null;
    return {
      sector: d.b_sector || d.b_type || "",
      type: d.b_type || "",
      source: "public",
    };
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
// 거래처 업종 조회: DB+공공API 병렬 비교 → 불일치 시 API 우선
// ============================================================
async function lookupBusinessInfo(tradeName: string, code: string): Promise<BusinessInfo> {
  // 1순위: 사업자번호로 DB 조회 — hit 시 즉시 반환 (공공API 생략)
  const dbByBno = await searchDbByBno(code);
  if (dbByBno) return dbByBno;

  // 2순위: 공공데이터 API
  const publicData = await searchPublicDataBizInfo(code);
  if (publicData) return publicData;

  // 3순위: 이름 기반 DB 조회 + 네이버 병렬
  const [dbByName, naver] = await Promise.all([
    searchDbByName(tradeName),
    searchNaverBizInfo(tradeName),
  ]);
  return dbByName ?? naver ?? { sector: "", type: "", source: "" };
}

// ============================================================
// 분류 (DB/네이버 업종 정보 → classifyTransaction 활용)
// ============================================================
function classifyCashReceipt(
  row: CashReceiptRow,
  bizInfo: BusinessInfo,
  conditions: BusinessConditions,
  rules: MatchingRule[] = []
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

  const result = classifyTransaction(txRow, conditions, rules);

  if (result.confidence !== "low") {
    return result;
  }

  // 업종 텍스트로 추가 분류 시도 (industry 모드: 표준 행정 용어이므로 단순 포함 검사)
  if (bizInfo.sector) {
    const category = classifyBusiness(bizInfo.sector, 'industry');
    if (category.label !== "일반사업체") {
      const catAccount = CATEGORY_ACCOUNT_MAP[category.label];
      if (catAccount) {
        return {
          code: catAccount.code,
          name: catAccount.name,
          tag: catAccount.tag,
          confidence: "medium",
          note: `${bizInfo.source === "db" ? "DB" : bizInfo.source === "public" ? "공공데이터" : "네이버"}: ${bizInfo.sector}`,
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
  const [sortConfig, setSortConfig] = useState<{ field: "code" | "name" | "tradeName" | "tag"; dir: "asc" | "desc" } | null>(null);

  // 인라인 편집
  const [editingCell, setEditingCell] = useState<{ origIdx: number; field: "account" | "tag" } | null>(null);
  const [editValue, setEditValue] = useState("");

  // 체크박스 / 일괄 변경
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());
  const [lastCheckedFilteredIdx, setLastCheckedFilteredIdx] = useState<number | null>(null);
  const [bulkAccount, setBulkAccount] = useState("");
  const [bulkTag, setBulkTag] = useState("");

  // 업종 조회 캐시 (거래처명 → BusinessInfo)
  const bizCacheRef = useRef<Map<string, BusinessInfo>>(new Map());

  // 노션 규칙 (마운트 시 fetch)
  const notionRulesRef = useRef<MatchingRule[]>([]);

  useEffect(() => {
    fetch("/api/notion/rules")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.rules) {
          notionRulesRef.current = convertNotionRules(data.rules);
        }
      })
      .catch(() => {});
  }, []);

  // 열 너비 (드래그 리사이즈)
  const [colWidths, setColWidths] = useState({ vendor: 140, total: 90, origDebit: 100, account: 160, biz: 110 });
  const resizingRef = useRef<{ col: keyof typeof colWidths; startX: number; startWidth: number } | null>(null);

  const startResize = (col: keyof typeof colWidths, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { col, startX: e.clientX, startWidth: colWidths[col] };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.max(40, resizingRef.current.startWidth + ev.clientX - resizingRef.current.startX);
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.col]: newWidth }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 탭: "classify" | "history"
  const [activeTab, setActiveTab] = useState<"classify" | "history">("classify");

  // 히스토리 목록
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);

  // localStorage 히스토리 로드 (마운트 시)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cashreceipt_history");
      if (saved) {
        const parsed: HistoryEntry[] = JSON.parse(saved);
        if (Array.isArray(parsed)) setHistoryList(parsed);
      }
    } catch {}
  }, []);

  // 히스토리 저장 함수 (개수 제한 없음 — 용량 초과 시 가장 오래된 항목부터 제거)
  const saveToHistory = useCallback((name: string, rows: ClassifiedCashRow[]) => {
    const newEntry: HistoryEntry = {
      id: Date.now().toString(),
      fileName: name,
      savedAt: new Date().toISOString(),
      count: rows.length,
      classified: rows,
    };
    setHistoryList((prev) => {
      const updated = [newEntry, ...prev];
      let list = updated;
      while (list.length > 0) {
        try {
          localStorage.setItem("cashreceipt_history", JSON.stringify(list));
          break;
        } catch {
          list = list.slice(0, list.length - 1); // 가장 오래된 항목 제거 후 재시도
        }
      }
      return list;
    });
  }, []);

  // 히스토리 항목 불러오기
  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setClassified(entry.classified);
    setFileName(entry.fileName);
    setActiveTab("classify");
  }, []);

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

      // DB/네이버 순차 조회 (100개씩 병렬)
      for (let i = 0; i < uncached.length; i += 100) {
        const batch = uncached.slice(i, i + 100);
        const results = await Promise.all(
          batch.map((name) => lookupBusinessInfo(name, uniqueEntries.get(name) || ""))
        );
        batch.forEach((name, idx) => {
          cache.set(name, results[idx]);
        });
        setProgress({ current: Math.min(i + 100, uncached.length), total: uncached.length });
      }

      // 분류 실행
      const classifiedRows: ClassifiedCashRow[] = rows.map((input) => {
        const bizInfo = cache.get(input.거래처) || { sector: "", type: "", source: "" as const };
        const result = classifyCashReceipt(input, bizInfo, conditions, notionRulesRef.current);
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
      saveToHistory(file.name, classifiedRows);
    } catch {
      setError("파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [conditions, saveToHistory]);

  const handleReClassify = () => {
    if (classified.length === 0) return;
    const results = classified.map((c) => {
      const bizInfo = bizCacheRef.current.get(c.input.거래처) || { sector: "", type: "", source: "" as const };
      const result = classifyCashReceipt(c.input, bizInfo, conditions, notionRulesRef.current);
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

  // classified 인덱스 맵 (indexOf O(n) → O(1))
  const classifiedIndexMap = useMemo(() => {
    const map = new Map<ClassifiedCashRow, number>();
    classified.forEach((c, i) => map.set(c, i));
    return map;
  }, [classified]);

  // 통계
  const { total, changedCount, lowCount, excludeCount } = useMemo(() => ({
    total: classified.length,
    changedCount: classified.filter((c) => c.changed).length,
    lowCount: classified.filter((c) => c.result.confidence === "low").length,
    excludeCount: classified.filter((c) => c.result.tag === "전송제외").length,
  }), [classified]);

  const filteredRows = useMemo(() => {
    let rows = classified.filter((c) => {
      const eff = getEffectiveResult(c);
      if (filter === "changed") return c.changed || !!c.manualOverride;
      if (filter === "review") return c.result.confidence === "low" && !c.manualOverride;
      if (filter === "exclude") return eff.tag === "전송제외";
      return true;
    });
    if (sortConfig) {
      rows = [...rows].sort((a, b) => {
        let va = "", vb = "";
        if (sortConfig.field === "tradeName") { va = a.input.거래처; vb = b.input.거래처; }
        else if (sortConfig.field === "tag") { va = getEffectiveResult(a).tag; vb = getEffectiveResult(b).tag; }
        else if (sortConfig.field === "code") { va = getEffectiveResult(a).code; vb = getEffectiveResult(b).code; }
        else { va = getEffectiveResult(a).name; vb = getEffectiveResult(b).name; }
        const cmp = va.localeCompare(vb, "ko");
        return sortConfig.dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [classified, filter, sortConfig]);

  // 정렬 토글
  const toggleSort = (field: "code" | "name" | "tradeName" | "tag") => {
    setSortConfig((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "asc" };
      if (prev.dir === "asc") return { field, dir: "desc" };
      return null;
    });
  };

  // 체크박스 클릭 (shift 범위 선택 포함)
  const handleCheckbox = (filteredIdx: number, origIdx: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastCheckedFilteredIdx !== null) {
      const start = Math.min(lastCheckedFilteredIdx, filteredIdx);
      const end = Math.max(lastCheckedFilteredIdx, filteredIdx);
      const rangeOrigIndices = filteredRows.slice(start, end + 1).map((c) => classified.indexOf(c));
      setCheckedIndices((prev) => {
        const next = new Set(prev);
        rangeOrigIndices.forEach((idx) => next.add(idx));
        return next;
      });
    } else {
      setCheckedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(origIdx)) next.delete(origIdx);
        else next.add(origIdx);
        return next;
      });
    }
    setLastCheckedFilteredIdx(filteredIdx);
  };

  // 전체 선택/해제
  const toggleSelectAll = () => {
    if (checkedIndices.size === filteredRows.length) {
      setCheckedIndices(new Set());
    } else {
      setCheckedIndices(new Set(filteredRows.map((c) => classified.indexOf(c))));
    }
  };

  // 일괄 계정과목 적용
  const applyBulkAccount = (code: string, name: string) => {
    const defaultTag = CODE_TO_ACCOUNT[code]?.tag ?? "매입";
    setClassified((prev) => prev.map((c, i) => {
      if (!checkedIndices.has(i)) return c;
      const currentTag = c.manualOverride?.tag ?? c.result.tag;
      return { ...c, manualOverride: { code, name, tag: currentTag || defaultTag }, changed: true };
    }));
    setBulkAccount("");
  };

  // 일괄 태그 적용
  const applyBulkTag = (tag: string) => {
    setClassified((prev) => prev.map((c, i) => {
      if (!checkedIndices.has(i)) return c;
      const eff = getEffectiveResult(c);
      return { ...c, manualOverride: { code: eff.code, name: eff.name, tag }, changed: true };
    }));
    setBulkTag("");
  };

  // 셀 계정과목 적용
  const applyOverride = (origIdx: number, code: string, name: string) => {
    const defaultTag = CODE_TO_ACCOUNT[code]?.tag ?? "매입";
    setClassified((prev) => prev.map((c, i) => {
      if (i !== origIdx) return c;
      const currentTag = c.manualOverride?.tag ?? c.result.tag;
      return { ...c, manualOverride: { code, name, tag: currentTag || defaultTag }, changed: true };
    }));
    setEditingCell(null);
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
        <div className="bg-violet-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">현금영수증 계정과목 분류</h1>
          <p className="text-violet-100 text-xs font-bold uppercase tracking-widest opacity-80">
            Cash Receipt Account Classification
          </p>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-slate-100">
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-bold transition-colors border-b-2 ${activeTab === "history" ? "border-violet-600 text-violet-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            <span>🕓</span> 히스토리 {historyList.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded-full text-[10px]">{historyList.length}</span>}
          </button>
          <button
            onClick={() => setActiveTab("classify")}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-bold transition-colors border-b-2 ${activeTab === "classify" ? "border-violet-600 text-violet-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            <span>📋</span> 분류하기
          </button>
        </div>

        {/* 히스토리 탭 */}
        {activeTab === "history" && (
          <div className="p-6 space-y-3">
            {historyList.length === 0 ? (
              <div className="text-center py-12 text-slate-300">
                <div className="text-4xl mb-3">🕓</div>
                <p className="text-sm font-bold">저장된 히스토리가 없습니다</p>
                <p className="text-xs mt-1">분류하기 탭에서 파일을 업로드하면 자동으로 저장됩니다</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] text-slate-400 font-bold">{historyList.length}개 저장됨</p>
                  <button
                    onClick={() => {
                      if (!confirm("히스토리를 전체 삭제하시겠습니까?")) return;
                      setHistoryList([]);
                      try { localStorage.removeItem("cashreceipt_history"); } catch {}
                    }}
                    className="text-[11px] text-slate-300 hover:text-red-400 font-bold transition-colors"
                  >
                    전체 삭제
                  </button>
                </div>
                {historyList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between bg-slate-50 hover:bg-blue-50 rounded-2xl px-4 py-3 gap-3 cursor-pointer transition-colors group"
                    onClick={() => loadFromHistory(entry)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-slate-700 truncate group-hover:text-blue-700 transition-colors">{entry.fileName}</p>
                      <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                        {new Date(entry.savedAt).toLocaleString("ko-KR")} &nbsp;·&nbsp; {entry.count}건
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          const wb = buildOutputWorkbook(entry.classified);
                          XLSX.writeFile(wb, entry.fileName.replace(/\.(xlsx?)/i, "_분류결과.xls"));
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors"
                      >
                        다운로드
                      </button>
                      <button
                        onClick={() => {
                          setHistoryList((prev) => {
                            const updated = prev.filter((e) => e.id !== entry.id);
                            try { localStorage.setItem("cashreceipt_history", JSON.stringify(updated)); } catch {}
                            return updated;
                          });
                        }}
                        className="px-2 py-1.5 text-slate-300 hover:text-red-400 rounded-xl text-xs font-bold transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === "classify" && <div className="p-6 space-y-5">
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
                  거래처 조회 중... ({progress.current}/{progress.total})
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
                  .xlsx 파일 지원 · 공공데이터/네이버 검색으로 업종 자동 조회
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
              <div className="border border-slate-300 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="text-xs w-full border-collapse" style={{ tableLayout: "fixed" }}>
                    <thead className="bg-slate-100 text-slate-600 font-semibold text-[11px] sticky top-0 z-10">
                      <tr className="border-b border-slate-300">
                        <th className="px-2 py-2 text-center align-middle border-r border-slate-300" style={{ width: 36 }}>
                          <input type="checkbox"
                            checked={filteredRows.length > 0 && checkedIndices.size === filteredRows.length}
                            onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer"
                          />
                        </th>
                        <th className="px-2 py-2 text-center align-middle border-r border-slate-300" style={{ width: 40 }}>번호</th>
                        <th className="px-3 py-2 text-left border-r border-slate-300" style={{ width: 72 }}>일자</th>
                        <th className="px-3 py-2 text-left relative select-none border-r border-slate-300" style={{ width: colWidths.vendor }}>
                          <span className="cursor-pointer hover:text-blue-500 transition-colors" onClick={() => toggleSort("tradeName")}>
                            거래처{" "}{sortConfig?.field === "tradeName" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                          </span>
                          <div className="absolute -right-1 top-0 h-full w-2 cursor-col-resize z-10" onMouseDown={(e) => startResize("vendor", e)} />
                        </th>
                        <th className="px-3 py-2 text-right relative select-none border-r border-slate-300" style={{ width: colWidths.total }}>
                          합계
                          <div className="absolute -right-1 top-0 h-full w-2 cursor-col-resize z-10" onMouseDown={(e) => startResize("total", e)} />
                        </th>
                        <th className="px-3 py-2 text-left relative select-none border-r border-slate-300" style={{ width: colWidths.origDebit }}>
                          기존 차변
                          <div className="absolute -right-1 top-0 h-full w-2 cursor-col-resize z-10" onMouseDown={(e) => startResize("origDebit", e)} />
                        </th>
                        <th className="px-2 py-2 text-center border-r border-slate-300" style={{ width: 28 }}>→</th>
                        <th className="px-3 py-2 text-left relative select-none border-r border-slate-300" style={{ width: colWidths.account }}>
                          <span className="cursor-pointer hover:text-blue-500 transition-colors" onClick={() => toggleSort("name")}>
                            계정과목{" "}{sortConfig?.field === "name" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                          </span>
                          <div className="absolute -right-1 top-0 h-full w-2 cursor-col-resize z-10" onMouseDown={(e) => startResize("account", e)} />
                        </th>
                        <th className="px-2 py-2 text-center cursor-pointer select-none hover:text-blue-500 transition-colors border-r border-slate-300" style={{ width: 52 }} onClick={() => toggleSort("tag")}>
                          구분{" "}{sortConfig?.field === "tag" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                        </th>
                        <th className="px-3 py-2 text-left relative select-none" style={{ width: colWidths.biz }}>
                          업종
                          <div className="absolute -right-1 top-0 h-full w-2 cursor-col-resize z-10" onMouseDown={(e) => startResize("biz", e)} />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {filteredRows.map((c, i) => {
                        const origIdx = classifiedIndexMap.get(c) ?? i;
                        const eff = getEffectiveResult(c);
                        const isChecked = checkedIndices.has(origIdx);
                        const isLow = c.result.confidence === "low" && !c.manualOverride;
                        const isExclude = eff.tag === "전송제외";
                        const rowBg = isChecked
                          ? "bg-blue-50"
                          : isLow ? "bg-red-50"
                          : (c.changed || c.manualOverride) ? "bg-orange-50"
                          : isExclude ? "bg-slate-50"
                          : "";
                        const tagColor = eff.tag === "매입" ? "bg-purple-100 text-purple-700"
                          : eff.tag === "일반" ? "bg-slate-100 text-slate-600"
                          : eff.tag === "전송제외" ? "bg-red-100 text-red-600"
                          : "bg-slate-100 text-slate-500";
                        const confIcon = c.manualOverride ? "✎" : c.result.confidence === "high" ? "●" : c.result.confidence === "medium" ? "◐" : "○";
                        const confColor = c.manualOverride ? "text-blue-500" : c.result.confidence === "high" ? "text-green-500" : c.result.confidence === "medium" ? "text-amber-500" : "text-red-500";
                        const isEditingAccount = editingCell?.origIdx === origIdx && editingCell?.field === "account";
                        const isEditingTag = editingCell?.origIdx === origIdx && editingCell?.field === "tag";

                        return (
                          <tr key={i} className={`border-t border-slate-200 hover:bg-blue-50/30 transition-colors ${rowBg}`}>
                            <td className="px-2 py-1.5 text-center align-middle border-r border-slate-200" onClick={(e) => { e.stopPropagation(); handleCheckbox(i, origIdx, e); }}>
                              <input type="checkbox" checked={isChecked} onChange={() => {}} className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer" />
                            </td>
                            <td className="px-2 py-1.5 text-center align-middle text-slate-400 tabular-nums border-r border-slate-200">{origIdx + 1}</td>
                            <td className="px-3 py-1.5 text-slate-500 truncate border-r border-slate-200">{c.input.일자}</td>
                            <td className="px-3 py-1.5 truncate border-r border-slate-200" style={{ maxWidth: colWidths.vendor }} title={c.input.거래처}>{c.input.거래처}</td>
                            <td className="px-3 py-1.5 text-right text-slate-500 tabular-nums truncate border-r border-slate-200" style={{ maxWidth: colWidths.total }}>{c.input.합계.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-slate-400 truncate border-r border-slate-200" style={{ maxWidth: colWidths.origDebit }}>{c.original차변 || "-"}</td>
                            <td className="px-2 py-1.5 text-center border-r border-slate-200">
                              {(c.changed || c.manualOverride) ? <span className="text-orange-500 font-black">→</span> : <span className="text-green-400">=</span>}
                            </td>
                            {/* 계정과목 편집 */}
                            <td className="px-3 py-1.5 relative border-r border-slate-200">
                              {isEditingAccount ? (
                                <div className="flex flex-col gap-1 min-w-[200px]">
                                  <AccountAutocomplete
                                    autoFocus
                                    value={editValue}
                                    onChange={setEditValue}
                                    onSelect={(code, name) => applyOverride(origIdx, code, name)}
                                    onCancel={() => { setEditingCell(null); setEditValue(""); }}
                                    placeholder="코드(830) 또는 계정과목명"
                                    className="w-full px-2 py-1 border border-blue-400 rounded text-[10px] font-bold outline-none bg-white"
                                  />
                                  <button onClick={() => { setEditingCell(null); setEditValue(""); }} className="px-1 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold">취소</button>
                                </div>
                              ) : (
                                <button onClick={() => { setEditingCell({ origIdx, field: "account" }); setEditValue(""); }} className="w-full text-left group">
                                  <span className={confColor}>{confIcon}</span>{" "}
                                  {eff.code && <span className="text-[9px] text-slate-400 tabular-nums font-bold mr-1">{eff.code}</span>}
                                  {eff.name || "-"}
                                  {c.manualOverride && <span className="ml-1 text-[8px] text-blue-400 font-bold">[수기]</span>}
                                  <span className="ml-1 text-[8px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                                  {!c.manualOverride && c.result.note && (
                                    <span className="block text-[9px] text-slate-400 font-normal truncate max-w-[120px]">{c.result.note}</span>
                                  )}
                                </button>
                              )}
                            </td>
                            {/* 태그 편집 */}
                            <td className="px-2 py-1.5 text-center relative border-r border-slate-200">
                              {isEditingTag ? (
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 bg-white border border-blue-200 rounded-xl shadow-lg p-1 flex flex-col gap-0.5 min-w-[80px]">
                                  {["매입", "일반", "전송제외"].map((tag) => (
                                    <button key={tag} onClick={() => applyTagOverride(origIdx, tag)}
                                      className={`px-2 py-1 rounded text-[10px] font-bold text-left transition-colors ${tag === "매입" ? "hover:bg-purple-100 text-purple-700" : tag === "일반" ? "hover:bg-slate-100 text-slate-600" : "hover:bg-red-100 text-red-600"}`}>
                                      {tag}
                                    </button>
                                  ))}
                                  <button onClick={() => setEditingCell(null)} className="px-2 py-0.5 text-[9px] text-slate-400 hover:text-slate-600">취소</button>
                                </div>
                              ) : (
                                <button onClick={() => { setEditingCell({ origIdx, field: "tag" }); }} className="group">
                                  {eff.tag ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${tagColor} group-hover:opacity-80 transition-opacity`}>{eff.tag}</span>
                                  ) : <span className="text-slate-300 text-[9px]">-</span>}
                                  {c.manualOverride?.tag && <span className="ml-0.5 text-[7px] text-blue-400">[수]</span>}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-[10px] text-slate-400 truncate" style={{ maxWidth: colWidths.biz }}>
                              {c.bizInfo.sector ? `${c.bizInfo.source === "db" ? "[DB]" : c.bizInfo.source === "public" ? "[공공]" : c.bizInfo.source === "naver" ? "[N]" : ""} ${c.bizInfo.sector}` : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 일괄 변경 바 */}
              {checkedIndices.size > 0 && (
                <div className="bg-blue-600 rounded-2xl p-4 flex flex-wrap items-center gap-3 shadow-lg">
                  <span className="text-white font-black text-sm">{checkedIndices.size}개 선택됨</span>
                  <div className="flex-1 flex flex-wrap gap-2">
                    <div className="flex-1 min-w-[200px]">
                      <AccountAutocomplete
                        value={bulkAccount}
                        onChange={setBulkAccount}
                        onSelect={(code, name) => {
                          applyBulkAccount(code, name);
                          if (bulkTag) applyBulkTag(bulkTag);
                          setCheckedIndices(new Set());
                          setBulkTag("");
                        }}
                        placeholder="코드(830) 또는 계정과목명"
                        className="w-full px-3 py-2 rounded-xl text-xs font-bold outline-none bg-white text-slate-700"
                        dropdownPosition="above"
                      />
                    </div>
                    <select value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}
                      className="px-3 py-2 rounded-xl text-xs font-bold outline-none bg-white text-slate-700">
                      <option value="">구분 선택</option>
                      <option value="매입">매입</option>
                      <option value="일반">일반</option>
                      <option value="전송제외">전송제외</option>
                    </select>
                    <button
                      onClick={() => {
                        if (bulkTag) applyBulkTag(bulkTag);
                        setCheckedIndices(new Set());
                      }}
                      className="px-4 py-2 bg-white text-blue-600 rounded-xl text-xs font-black hover:bg-blue-50 transition-colors"
                    >
                      구분만 적용
                    </button>
                  </div>
                  <button onClick={() => { setCheckedIndices(new Set()); setBulkAccount(""); setBulkTag(""); }}
                    className="text-blue-200 hover:text-white text-xs font-bold transition-colors">선택 해제</button>
                </div>
              )}

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
        </div>}
      </div>
    </div>
  );
}
