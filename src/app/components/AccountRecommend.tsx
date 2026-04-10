"use client";
import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  classifyTransaction,
  classifyBusiness,
  CATEGORY_ACCOUNT_MAP,
  ACCOUNT_NAME_TO_CODE,
  CODE_TO_ACCOUNT,
  NAME_TO_CODE,
  type TransactionRow,
  type BusinessConditions,
  type ClassificationResult,
} from "@/lib/accountClassifier";

// ============================================================
// AI Classification Types
// ============================================================
interface AiClassifyResult {
  tradeName: string;
  code: string;
  name: string;
  tag: string;
  reasoning: string;
  isNewRule: boolean;
  suggestedExample?: string;
}

interface NewRuleCandidate {
  aiResult: AiClassifyResult;
  confirmed: boolean;
  editing: boolean;
  editCode: string;
  editName: string;
  editTag: string;
  editExample: string;
  editNote: string;
}

// ============================================================
// Types
// ============================================================
interface InputRow {
  연도: string;
  일자: string;
  Code: string;
  거래처: string;
  구분: string;
  품명: string;
  공급가액: number;
  세액: number;
  비과세: number | null;
  합계: number;
  국세청: string;
  업태: string;
  종목: string;
  유형: string;
  차변계정: string | null;
  대변계정: string;
  관리: string;
  전표상태: string;
  사업자등록번호: string;
}

interface ManualOverride {
  code: string;
  name: string;
  tag: string;
}

interface ClassifiedRow {
  input: InputRow;
  result: ClassificationResult;
  bizInfo: BusinessInfo;
  aiResult?: AiClassifyResult;
  manualOverride?: ManualOverride;
}

interface BusinessInfo {
  sector: string;
  type: string;
  source: "" | "db" | "naver";
}

// ============================================================
// 계정과목 수기 편집 헬퍼 (상수는 accountClassifier.ts에서 import)
// ============================================================

const SOMOUM_CODES = [
  { code: "530", desc: "제조원가" },
  { code: "630", desc: "공사원가" },
  { code: "730", desc: "기타원가" },
  { code: "830", desc: "판관비(일반)" },
];

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

function getEffectiveResult(c: ClassifiedRow): ClassificationResult {
  if (c.manualOverride) {
    return { ...c.result, code: c.manualOverride.code, name: c.manualOverride.name, tag: c.manualOverride.tag };
  }
  return c.result;
}

// ============================================================
// 거래처명 정규화 및 매칭
// ============================================================
function normalizeName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|（주）|\(주\)|㈜|\(|\)|\s)/g, "").toLowerCase();
}

function isNameMatch(title: string, query: string): boolean {
  const t = normalizeName(title);
  const q = normalizeName(query);
  if (!t || !q) return false;
  return t === q || t.startsWith(q) || q.startsWith(t);
}

function cleanCorpName(name: string): string {
  return name.replace(/(주식회사|유한회사|유한책임회사|（주）|\(주\)|㈜|\(|\))/g, "").trim();
}

// ============================================================
// DB 조회
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
async function lookupBusinessInfo(tradeName: string, bno: string): Promise<BusinessInfo> {
  const dbByBno = await searchDbByBno(bno);
  if (dbByBno) return dbByBno;

  const dbByName = await searchDbByName(tradeName);
  if (dbByName) return dbByName;

  const naver = await searchNaverBizInfo(tradeName);
  if (naver) return naver;

  return { sector: "", type: "", source: "" };
}

// ============================================================
// Constants
// ============================================================
const BUSINESS_TYPE_OPTIONS = [
  { value: "그 외", label: "그 외" },
  { value: "도소매", label: "도소매" },
  { value: "음식점업", label: "음식점업" },
  { value: "건설업", label: "건설업" },
  { value: "제조업", label: "제조업" },
];

const INPUT_HEADERS = [
  "연도", "일자", "Code", "거래처", "구분", "품명", "공급가액", "세액",
  "비과세", "합계", "국세청", "업태", "종목", "유형", "차변계정", "대변계정",
  "관리", "전표상태", "사업자등록번호",
];

// SmartA10 계정과목 참고용 시트 데이터 (800번대 판관비 중심)
const ACCOUNT_REF_DATA = [
  ["코드", "계정과목"],
  ["101", "현금"], ["103", "보통예금"], ["108", "외상매출금"],
  ["120", "미수금"], ["131", "선급금"], ["135", "부가세대급금"],
  ["146", "상품"], ["253", "미지급금"], ["254", "예수금"],
  ["255", "부가세예수금"],
  ["801", "임원급여"], ["802", "직원급여"], ["803", "상여금"],
  ["804", "제수당"], ["805", "잡급"], ["806", "퇴직급여"],
  ["811", "복리후생비"], ["812", "여비교통비"],
  ["813", "접대비(기업업무추진비)"], ["814", "통신비"],
  ["815", "수도광열비"], ["816", "전력비"], ["817", "세금과공과금"],
  ["818", "감가상각비"], ["819", "지급임차료"], ["820", "수선비"],
  ["821", "보험료"], ["822", "차량유지비"], ["823", "경상연구개발비"],
  ["824", "운반비"], ["825", "교육훈련비"], ["826", "도서인쇄비"],
  ["827", "회의비"], ["828", "포장비"], ["829", "사무용품비"],
  ["830", "소모품비"], ["831", "지급수수료"], ["832", "보관료"],
  ["833", "광고선전비"], ["834", "판매촉진비"], ["835", "대손상각비"],
  ["837", "건물관리비"],
];

// ============================================================
// Helpers
// ============================================================
function parseInputExcel(buffer: ArrayBuffer): InputRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (raw.length < 2) return [];

  // 헤더 행 찾기 — 첫 번째 행이 헤더와 일치하는지 확인
  const headerRow = raw[0] as string[];
  const headerMatch = INPUT_HEADERS.every((h, i) => headerRow[i] === h);
  const dataStart = headerMatch ? 1 : 0;

  const rows: InputRow[] = [];
  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || r.length < 19) continue;
    // 거래처가 없으면 skip
    if (!r[3]) continue;

    rows.push({
      연도: String(r[0] ?? ""),
      일자: String(r[1] ?? ""),
      Code: String(r[2] ?? ""),
      거래처: String(r[3] ?? ""),
      구분: String(r[4] ?? ""),
      품명: String(r[5] ?? ""),
      공급가액: Number(r[6]) || 0,
      세액: Number(r[7]) || 0,
      비과세: r[8] != null ? Number(r[8]) : null,
      합계: Number(r[9]) || 0,
      국세청: String(r[10] ?? ""),
      업태: String(r[11] ?? ""),
      종목: String(r[12] ?? ""),
      유형: String(r[13] ?? ""),
      차변계정: r[14] != null ? String(r[14]) : null,
      대변계정: String(r[15] ?? ""),
      관리: String(r[16] ?? ""),
      전표상태: String(r[17] ?? ""),
      사업자등록번호: String(r[18] ?? ""),
    });
  }
  return rows;
}

function classifyRow(
  input: InputRow,
  bizInfo: BusinessInfo,
  conditions: BusinessConditions
): ClassificationResult {
  // 업태/종목: 엑셀 데이터 우선, 없으면 DB/네이버 데이터 사용
  const businessType = input.업태 || bizInfo.sector;
  const sector = input.종목 || bizInfo.type;

  const txRow: TransactionRow = {
    tradeName: input.거래처,
    businessType,
    sector,
    amount: input.합계,
    ntsStatus: input.국세청,
    taxType: input.유형,
  };

  const result = classifyTransaction(txRow, conditions);

  if (result.confidence !== "low") {
    return result;
  }

  // low confidence일 때 DB/네이버 카테고리로 추가 분류 시도
  const categoryText = bizInfo.sector || businessType;
  if (categoryText) {
    const category = classifyBusiness(categoryText);
    if (category.label !== "일반사업체") {
      const catAccount = CATEGORY_ACCOUNT_MAP[category.label];
      if (catAccount) {
        return {
          code: catAccount.code,
          name: catAccount.name,
          tag: catAccount.tag,
          confidence: "medium",
          note: `${bizInfo.source === "db" ? "DB" : bizInfo.source === "naver" ? "네이버" : "카테고리"}: ${categoryText}`,
        };
      }
    }
  }

  return result;
}

function buildSmartA10Workbook(classified: ClassifiedRow[]): XLSX.WorkBook {
  // Sheet 1: 신용카드 매입
  const outputRows: (string | number | null)[][] = [
    [
      "거래일자", "거래처(가맹점명)", "사업자번호", "품명", "유형",
      "공급가액", "세액", "봉사료", "합계",
      "차변계정코드", "대변계정코드", "공제여부", "거래구분",
    ],
  ];

  for (const { input, result } of classified) {
    const date = input.연도 && input.일자
      ? `${input.연도}-${input.일자}`
      : "";
    const debitCode = result.tag === "전송제외" ? "" : result.code;
    const creditCode = ACCOUNT_NAME_TO_CODE[input.대변계정] || input.대변계정;
    // 매입 = 공제, 그 외 = 불공제
    const deductible = result.tag === "매입" ? "공제" : "불공제";

    outputRows.push([
      date,
      input.거래처,
      input.사업자등록번호,
      null, // 품명: 빈칸
      input.구분,       // 유형 = 원본 엑셀의 구분(법인/일반 등)
      input.공급가액,
      input.세액,
      null, // 봉사료
      input.합계,
      debitCode,
      creditCode,
      deductible,       // 공제여부: 매입→공제, 그 외→불공제
      "승인",           // 거래구분: 무조건 승인
    ]);
  }

  const ws1 = XLSX.utils.aoa_to_sheet(outputRows);
  // 열 너비 설정
  ws1["!cols"] = [
    { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 6 },
    { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 },
  ];

  // Sheet 2: 계정과목(참고용)
  const refRows: (string | null)[][] = [
    ["※ 본 계정과목을 참조하여 [신용카드 매입] sheet의 [계정과목코드]를 입력하시기 바랍니다."],
    [],
    ...ACCOUNT_REF_DATA.map((r) => [r[0], r[1]]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(refRows);
  ws2["!cols"] = [{ wch: 8 }, { wch: 25 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "신용카드 매입");
  XLSX.utils.book_append_sheet(wb, ws2, "계정과목(참고용)");
  return wb;
}

// ============================================================
// Component
// ============================================================
export default function AccountRecommend({ onBack }: { onBack: () => void }) {
  // 사업 조건
  const [conditions, setConditions] = useState<BusinessConditions>({
    hasEmployee: true,
    hasVehicle: false,
    isRefund: false,
    businessType: "그 외",
    isLargeCompany: false,
  });

  // 파일 및 분류 결과
  const [fileName, setFileName] = useState("");
  const [classified, setClassified] = useState<ClassifiedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // DB/네이버 조회 캐시 (거래처명 → BusinessInfo)
  const bizCacheRef = useRef<Map<string, BusinessInfo>>(new Map());

  // AI 분류
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [newRuleCandidates, setNewRuleCandidates] = useState<NewRuleCandidate[]>([]);
  const [showNewRuleModal, setShowNewRuleModal] = useState(false);
  const [savingRule, setSavingRule] = useState(false);

  // 필터
  const [filter, setFilter] = useState<"all" | "high" | "review" | "exclude">("all");

  // 정렬
  const [sortConfig, setSortConfig] = useState<{ field: "code" | "name" | "tradeName" | "tag"; dir: "asc" | "desc" } | null>(null);

  // 인라인 편집
  const [editingCell, setEditingCell] = useState<{ origIdx: number; field: "account" | "tag" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [somoumPicker, setSomoumPicker] = useState<number | null>(null);

  // 체크박스 / 일괄 변경
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());
  const [lastCheckedFilteredIdx, setLastCheckedFilteredIdx] = useState<number | null>(null);
  const [bulkAccount, setBulkAccount] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkSomoumPicker, setBulkSomoumPicker] = useState(false);

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
      const rows = parseInputExcel(buffer);
      if (rows.length === 0) {
        setError("데이터를 찾을 수 없습니다. 파일 형식을 확인해주세요.");
        return;
      }

      // 고유 거래처명 + 사업자번호 매핑
      const uniqueEntries = new Map<string, string>();
      for (const r of rows) {
        if (!uniqueEntries.has(r.거래처)) {
          uniqueEntries.set(r.거래처, r.사업자등록번호 || r.Code);
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
      const classifiedRows: ClassifiedRow[] = rows.map((input) => {
        const bizInfo = cache.get(input.거래처) || { sector: "", type: "", source: "" as const };
        const result = classifyRow(input, bizInfo, conditions);
        return { input, result, bizInfo };
      });

      setClassified(classifiedRows);

      // AI 분류 자동 실행 (low confidence 항목 대상)
      const hasLow = classifiedRows.some((c) => c.result.confidence === "low");
      if (hasLow) {
        runAiClassify(classifiedRows).then((updated) => {
          setClassified(updated);
        });
      }
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
      const result = classifyRow(c.input, bizInfo, conditions);
      return { input: c.input, result, bizInfo };
    });
    setClassified(results);
  };

  // AI 분류 실행 (low confidence 항목 대상)
  const runAiClassify = useCallback(async (rows: ClassifiedRow[]) => {
    const lowItems = rows.filter((c) => c.result.confidence === "low");
    if (lowItems.length === 0) return rows;

    setAiLoading(true);
    setAiError("");

    try {
      // 1. 노션 규칙 조회
      const rulesRes = await fetch("/api/notion/rules");
      if (!rulesRes.ok) {
        setAiLoading(false);
        return rows; // 노션 연결 실패 시 기존 결과 유지
      }
      const { rules } = await rulesRes.json();

      // 2. AI 분류 요청 (20개씩 batch)
      const allAiResults: AiClassifyResult[] = [];
      for (let i = 0; i < lowItems.length; i += 20) {
        const batch = lowItems.slice(i, i + 20);
        const items = batch.map((c) => ({
          tradeName: c.input.거래처,
          businessType: c.input.업태 || c.bizInfo.sector,
          sector: c.input.종목 || c.bizInfo.type,
          amount: c.input.합계,
          conditions,
        }));

        const aiRes = await fetch("/api/ai/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, rules }),
        });

        if (aiRes.ok) {
          const data = await aiRes.json();
          allAiResults.push(...(data.results || []));
        }
      }

      // 3. AI 결과를 classified에 반영
      const aiMap = new Map<string, AiClassifyResult>();
      for (const r of allAiResults) {
        aiMap.set(r.tradeName, r);
      }

      const updated = rows.map((c) => {
        if (c.result.confidence !== "low") return c;
        const ai = aiMap.get(c.input.거래처);
        if (!ai) return c;
        return {
          ...c,
          result: {
            code: ai.code,
            name: ai.name,
            tag: ai.tag,
            confidence: "low" as const,
            note: `AI: ${ai.reasoning}`,
          },
          aiResult: ai,
        };
      });

      // 4. 신규 규칙 후보 수집
      const newRules = allAiResults
        .filter((r) => r.isNewRule)
        .map((r) => ({
          aiResult: r,
          confirmed: false,
          editing: false,
          editCode: r.code,
          editName: r.name,
          editTag: r.tag,
          editExample: r.suggestedExample || r.tradeName,
          editNote: "",
        }));

      if (newRules.length > 0) {
        setNewRuleCandidates(newRules);
        setShowNewRuleModal(true);
      }

      setAiLoading(false);
      return updated;
    } catch (err) {
      console.error("AI classify error:", err);
      setAiError("AI 분류 중 오류가 발생했습니다.");
      setAiLoading(false);
      return rows;
    }
  }, [conditions]);

  // 신규 규칙 노션에 저장
  const saveNewRule = async (candidate: NewRuleCandidate) => {
    setSavingRule(true);
    try {
      const res = await fetch("/api/notion/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          example: candidate.editExample,
          code: candidate.editCode,
          name: candidate.editName,
          tags: [candidate.editTag],
          note: candidate.editNote,
        }),
      });
      if (res.ok) {
        setNewRuleCandidates((prev) =>
          prev.map((c) =>
            c.aiResult.tradeName === candidate.aiResult.tradeName
              ? { ...c, confirmed: true }
              : c
          )
        );
      }
    } catch {
      // 저장 실패 시 무시
    } finally {
      setSavingRule(false);
    }
  };

  const handleDownload = () => {
    if (classified.length === 0) return;
    const wb = buildSmartA10Workbook(classified);
    XLSX.writeFile(wb, "SmartA10_신용카드매입.xls");
  };

  // 통계
  const total = classified.length;
  const highCount = classified.filter((c) => c.result.confidence === "high").length;
  const mediumCount = classified.filter((c) => c.result.confidence === "medium").length;
  const lowCount = classified.filter((c) => c.result.confidence === "low" && !c.aiResult).length;
  const aiCount = classified.filter((c) => c.aiResult).length;
  const excludeCount = classified.filter((c) => c.result.tag === "전송제외").length;

  // 필터된 목록
  const filteredRows = (() => {
    let rows = classified.filter((c) => {
      const eff = getEffectiveResult(c);
      if (filter === "high") return c.result.confidence === "high" && !c.manualOverride;
      if (filter === "review") return (c.result.confidence === "low" || c.result.confidence === "medium") && !c.manualOverride;
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
  })();

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
      setCheckedIndices((prev) => { const next = new Set(prev); rangeOrigIndices.forEach((idx) => next.add(idx)); return next; });
    } else {
      setCheckedIndices((prev) => { const next = new Set(prev); if (next.has(origIdx)) next.delete(origIdx); else next.add(origIdx); return next; });
    }
    setLastCheckedFilteredIdx(filteredIdx);
  };

  const toggleSelectAll = () => {
    if (checkedIndices.size === filteredRows.length) setCheckedIndices(new Set());
    else setCheckedIndices(new Set(filteredRows.map((c) => classified.indexOf(c))));
  };

  const applyBulkAccount = (code: string, name: string) => {
    const defaultTag = CODE_TO_ACCOUNT[code]?.tag ?? "매입";
    setClassified((prev) => prev.map((c, i) => {
      if (!checkedIndices.has(i)) return c;
      const currentTag = c.manualOverride?.tag ?? c.result.tag;
      return { ...c, manualOverride: { code, name, tag: currentTag || defaultTag } };
    }));
    setBulkAccount(""); setBulkSomoumPicker(false);
  };

  const applyBulkTag = (tag: string) => {
    setClassified((prev) => prev.map((c, i) => {
      if (!checkedIndices.has(i)) return c;
      const eff = getEffectiveResult(c);
      return { ...c, manualOverride: { code: eff.code, name: eff.name, tag } };
    }));
    setBulkTag("");
  };

  const commitBulk = () => {
    if (!bulkAccount && !bulkTag) return;
    if (bulkAccount) {
      const parsed = resolveAccountInput(bulkAccount);
      if (!parsed) return;
      if (parsed.needsSomoumPicker) { setBulkSomoumPicker(true); return; }
      applyBulkAccount(parsed.code, parsed.name);
    }
    if (bulkTag) applyBulkTag(bulkTag);
    setCheckedIndices(new Set());
  };

  const commitAccountEdit = (origIdx: number, value: string) => {
    const parsed = resolveAccountInput(value);
    if (!parsed) { setEditingCell(null); setSomoumPicker(null); return; }
    if (parsed.needsSomoumPicker) { setSomoumPicker(origIdx); return; }
    applyOverride(origIdx, parsed.code, parsed.name);
  };

  const applyOverride = (origIdx: number, code: string, name: string) => {
    const defaultTag = CODE_TO_ACCOUNT[code]?.tag ?? "매입";
    setClassified((prev) => prev.map((c, i) => {
      if (i !== origIdx) return c;
      const currentTag = c.manualOverride?.tag ?? c.result.tag;
      return { ...c, manualOverride: { code, name, tag: currentTag || defaultTag } };
    }));
    setEditingCell(null); setSomoumPicker(null); setEditValue("");
  };

  const applyTagOverride = (origIdx: number, tag: string) => {
    setClassified((prev) => prev.map((c, i) => {
      if (i !== origIdx) return c;
      const eff = getEffectiveResult(c);
      return { ...c, manualOverride: { code: eff.code, name: eff.name, tag } };
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
        {/* Header */}
        <div className="bg-blue-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">카드전표 계정과목 분류</h1>
          <p className="text-blue-100 text-xs font-bold uppercase tracking-widest opacity-80">
            SmartA10 Card Classification
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
                  onChange={(e) =>
                    setConditions((c) => ({ ...c, hasEmployee: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">
                  4대보험 직원 있음
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.hasVehicle}
                  onChange={(e) =>
                    setConditions((c) => ({ ...c, hasVehicle: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">
                  사업장 차량 등록
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.isRefund}
                  onChange={(e) =>
                    setConditions((c) => ({ ...c, isRefund: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">환급 신고</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conditions.isLargeCompany}
                  onChange={(e) =>
                    setConditions((c) => ({
                      ...c,
                      isLargeCompany: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-600">
                  5인 이상 사업장
                </span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-400">업종</span>
              <select
                value={conditions.businessType}
                onChange={(e) =>
                  setConditions((c) => ({ ...c, businessType: e.target.value }))
                }
                className="flex-1 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400"
              >
                {BUSINESS_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
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
              dragging
                ? "border-blue-400 bg-blue-50"
                : "border-slate-200 hover:border-blue-300"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-2 text-slate-500 font-bold text-sm">
                <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                {progress.total > 0
                  ? `거래처 조회 중... (${progress.current}/${progress.total})`
                  : "분류 중..."}
              </div>
            ) : (
              <>
                <div className="text-3xl mb-2">&#128193;</div>
                <p className="text-sm font-bold text-slate-500">
                  SmartA10 카드매입 엑셀을 업로드하세요
                </p>
                <p className="text-[10px] text-slate-300 mt-1">
                  .xlsx 파일 지원 (차변계정이 비어있는 파일)
                </p>
                {fileName && (
                  <p className="text-[10px] text-blue-500 font-bold mt-2">
                    현재 파일: {fileName}
                  </p>
                )}
              </>
            )}
          </div>
          {error && (
            <p className="text-red-500 text-xs font-bold">&#9888;&#65039; {error}</p>
          )}

          {/* 분류 결과 */}
          {classified.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* 통계 */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setFilter("all")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "all"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <p className="text-lg font-black">{total}</p>
                  <p className="text-[10px] font-bold opacity-70">전체</p>
                </button>
                <button
                  onClick={() => setFilter("high")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "high"
                      ? "bg-green-500 text-white"
                      : "bg-green-50 text-green-600 hover:bg-green-100"
                  }`}
                >
                  <p className="text-lg font-black">{highCount}</p>
                  <p className="text-[10px] font-bold opacity-70">자동분류</p>
                </button>
                <button
                  onClick={() => setFilter("review")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "review"
                      ? "bg-amber-500 text-white"
                      : "bg-amber-50 text-amber-600 hover:bg-amber-100"
                  }`}
                >
                  <p className="text-lg font-black">{mediumCount + lowCount}</p>
                  <p className="text-[10px] font-bold opacity-70">확인필요</p>
                </button>
                {aiCount > 0 && (
                  <div className="p-3 rounded-xl bg-violet-50 text-center">
                    <p className="text-lg font-black text-violet-600">{aiCount}</p>
                    <p className="text-[10px] font-bold text-violet-500">AI추천</p>
                  </div>
                )}
                <button
                  onClick={() => setFilter("exclude")}
                  className={`p-3 rounded-xl text-center transition-colors ${
                    filter === "exclude"
                      ? "bg-red-500 text-white"
                      : "bg-red-50 text-red-600 hover:bg-red-100"
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
                        <th className="p-2 w-8">
                          <input type="checkbox"
                            checked={filteredRows.length > 0 && checkedIndices.size === filteredRows.length}
                            onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer"
                          />
                        </th>
                        <th className="p-2 text-left w-6">#</th>
                        <th className="p-2 text-left cursor-pointer select-none hover:text-blue-500 transition-colors" onClick={() => toggleSort("tradeName")}>
                          거래처{" "}{sortConfig?.field === "tradeName" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                        </th>
                        <th className="p-2 text-right whitespace-nowrap">합계</th>
                        <th className="p-2 text-center cursor-pointer select-none hover:text-blue-500 transition-colors" onClick={() => toggleSort("code")}>
                          코드{" "}{sortConfig?.field === "code" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                        </th>
                        <th className="p-2 text-left cursor-pointer select-none hover:text-blue-500 transition-colors" onClick={() => toggleSort("name")}>
                          계정과목{" "}{sortConfig?.field === "name" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                        </th>
                        <th className="p-2 text-center cursor-pointer select-none hover:text-blue-500 transition-colors" onClick={() => toggleSort("tag")}>
                          태그{" "}{sortConfig?.field === "tag" ? (sortConfig.dir === "asc" ? "▲" : "▼") : <span className="opacity-30">⇅</span>}
                        </th>
                        <th className="p-2 text-center">신뢰도</th>
                        <th className="p-2 text-left">업종</th>
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {filteredRows.map((c, i) => {
                        const origIdx = classified.indexOf(c);
                        const eff = getEffectiveResult(c);
                        const isChecked = checkedIndices.has(origIdx);
                        const isAi = !!c.aiResult;
                        const isLow = c.result.confidence === "low" && !isAi && !c.manualOverride;
                        const isMedium = c.result.confidence === "medium" && !c.manualOverride;
                        const isExclude = eff.tag === "전송제외";
                        const rowBg = isChecked ? "bg-blue-50"
                          : c.manualOverride ? "bg-indigo-50"
                          : isAi ? "bg-violet-50"
                          : isLow ? "bg-red-50"
                          : isMedium ? "bg-amber-50"
                          : isExclude ? "bg-slate-50" : "";
                        const tagColor = eff.tag === "매입" ? "bg-purple-100 text-purple-700"
                          : eff.tag === "일반" ? "bg-slate-100 text-slate-600"
                          : eff.tag === "전송제외" ? "bg-red-100 text-red-600"
                          : "bg-slate-100 text-slate-500";
                        const confColor = c.manualOverride ? "text-blue-500"
                          : isAi ? "text-violet-500"
                          : c.result.confidence === "high" ? "text-green-500"
                          : c.result.confidence === "medium" ? "text-amber-500" : "text-red-500";
                        const excelBiz = [c.input.업태, c.input.종목].filter(Boolean).join(" / ");
                        const fetchedBiz = c.bizInfo.sector ? `[${c.bizInfo.source === "db" ? "DB" : "N"}] ${c.bizInfo.sector}${c.bizInfo.type ? " / " + c.bizInfo.type : ""}` : "";
                        const bizDisplay = excelBiz || fetchedBiz || "-";
                        const isEditingAccount = editingCell?.origIdx === origIdx && editingCell?.field === "account";
                        const isEditingTag = editingCell?.origIdx === origIdx && editingCell?.field === "tag";
                        const isShowingSomoum = somoumPicker === origIdx;

                        return (
                          <tr key={i} className={`border-t border-slate-50 ${rowBg}`}>
                            <td className="p-2" onClick={(e) => { e.stopPropagation(); handleCheckbox(i, origIdx, e); }}>
                              <input type="checkbox" checked={isChecked} onChange={() => {}} className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer" />
                            </td>
                            <td className="p-2 text-slate-300">{origIdx + 1}</td>
                            <td className="p-2 max-w-[140px] truncate">{c.input.거래처}</td>
                            <td className="p-2 text-right text-slate-500 whitespace-nowrap">{c.input.합계.toLocaleString()}</td>
                            {/* 코드 */}
                            <td className="p-2 text-center font-black">
                              <span className={confColor}>{eff.code || "-"}</span>
                            </td>
                            {/* 계정과목 편집 */}
                            <td className="p-2 relative">
                              {isEditingAccount ? (
                                <div className="flex flex-col gap-1 min-w-[180px]">
                                  <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") commitAccountEdit(origIdx, editValue); if (e.key === "Escape") { setEditingCell(null); setSomoumPicker(null); } }}
                                    placeholder="코드(830) 또는 계정과목명"
                                    className="w-full px-2 py-1 border border-blue-400 rounded text-[10px] font-bold outline-none bg-white"
                                  />
                                  {isShowingSomoum && (
                                    <div className="absolute top-full left-0 z-20 bg-white border border-blue-200 rounded-xl shadow-lg p-2 flex gap-1 flex-wrap">
                                      <p className="w-full text-[9px] text-slate-400 font-bold mb-1">소모품비 코드 선택:</p>
                                      {SOMOUM_CODES.map(({ code, desc }) => (
                                        <button key={code} onClick={() => applyOverride(origIdx, code, "소모품비")}
                                          className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[10px] font-black transition-colors">
                                          {code} <span className="font-normal text-slate-500">{desc}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex gap-1">
                                    <button onClick={() => commitAccountEdit(origIdx, editValue)} className="flex-1 px-1 py-0.5 bg-blue-500 text-white rounded text-[9px] font-bold">확인</button>
                                    <button onClick={() => { setEditingCell(null); setSomoumPicker(null); setEditValue(""); }} className="flex-1 px-1 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold">취소</button>
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => { setEditingCell({ origIdx, field: "account" }); setEditValue(""); setSomoumPicker(null); }} className="w-full text-left group">
                                  {eff.name || "-"}
                                  {c.manualOverride && <span className="ml-1 text-[8px] text-blue-400 font-bold">[수기]</span>}
                                  <span className="ml-1 text-[8px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
                                  {!c.manualOverride && c.result.note && <span className="block text-[9px] text-slate-400 font-normal">{c.result.note}</span>}
                                </button>
                              )}
                            </td>
                            {/* 태그 편집 */}
                            <td className="p-2 text-center relative">
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
                                <button onClick={() => { setEditingCell({ origIdx, field: "tag" }); setSomoumPicker(null); }} className="group">
                                  {eff.tag ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap ${tagColor} group-hover:opacity-80 transition-opacity`}>{eff.tag}</span>
                                  ) : <span className="text-slate-300 text-[9px]">-</span>}
                                  {c.manualOverride?.tag && <span className="ml-0.5 text-[7px] text-blue-400">[수]</span>}
                                </button>
                              )}
                            </td>
                            <td className={`p-2 text-center text-[10px] ${confColor}`}>
                              {c.manualOverride ? "✎" : isAi ? "◇" : c.result.confidence === "high" ? "●" : c.result.confidence === "medium" ? "◐" : "○"}
                            </td>
                            <td className="p-2 text-[10px] text-slate-400 max-w-[150px] truncate">{bizDisplay}</td>
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
                    <div className="relative flex-1 min-w-[160px]">
                      <input value={bulkAccount} onChange={(e) => { setBulkAccount(e.target.value); setBulkSomoumPicker(false); }}
                        placeholder="코드(830) 또는 계정과목명"
                        className="w-full px-3 py-2 rounded-xl text-xs font-bold outline-none bg-white text-slate-700"
                      />
                      {bulkSomoumPicker && (
                        <div className="absolute bottom-full mb-1 left-0 z-20 bg-white border border-blue-200 rounded-xl shadow-lg p-2 flex gap-1 flex-wrap min-w-[220px]">
                          <p className="w-full text-[9px] text-slate-400 font-bold mb-1">소모품비 코드 선택:</p>
                          {SOMOUM_CODES.map(({ code, desc }) => (
                            <button key={code} onClick={() => { applyBulkAccount(code, "소모품비"); if (bulkTag) applyBulkTag(bulkTag); setCheckedIndices(new Set()); setBulkTag(""); }}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[10px] font-black transition-colors">
                              {code} <span className="font-normal text-slate-500">{desc}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <select value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}
                      className="px-3 py-2 rounded-xl text-xs font-bold outline-none bg-white text-slate-700">
                      <option value="">구분 선택</option>
                      <option value="매입">매입</option>
                      <option value="일반">일반</option>
                      <option value="전송제외">전송제외</option>
                    </select>
                    <button onClick={commitBulk} className="px-4 py-2 bg-white text-blue-600 rounded-xl text-xs font-black hover:bg-blue-50 transition-colors">일괄 적용</button>
                  </div>
                  <button onClick={() => { setCheckedIndices(new Set()); setBulkAccount(""); setBulkTag(""); setBulkSomoumPicker(false); }}
                    className="text-blue-200 hover:text-white text-xs font-bold transition-colors">선택 해제</button>
                </div>
              )}

              {/* 범례 */}
              <div className="flex gap-3 text-[10px] text-slate-400 font-bold justify-center flex-wrap">
                <span className="flex items-center gap-1"><span className="text-green-500">●</span> PDF규칙</span>
                <span className="flex items-center gap-1"><span className="text-amber-500">◐</span> 카테고리추정</span>
                <span className="flex items-center gap-1"><span className="text-violet-500">◇</span> AI추천</span>
                <span className="flex items-center gap-1"><span className="text-red-500">○</span> 미분류</span>
                <span className="flex items-center gap-1"><span className="text-blue-500">✎</span> 수기변경</span>
              </div>

              {/* AI 로딩 */}
              {aiLoading && (
                <div className="flex items-center justify-center gap-2 py-3 bg-violet-50 rounded-2xl">
                  <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-bold text-violet-600">
                    AI가 미분류 거래처를 분석 중입니다...
                  </span>
                </div>
              )}

              {/* AI 에러 */}
              {aiError && (
                <div className="text-xs text-red-500 font-bold text-center py-2 bg-red-50 rounded-xl">
                  {aiError}
                </div>
              )}

              {/* 신규 규칙 알림 */}
              {newRuleCandidates.length > 0 && !showNewRuleModal && newRuleCandidates.some((c) => !c.confirmed) && (
                <button
                  onClick={() => setShowNewRuleModal(true)}
                  className="w-full py-3 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2"
                >
                  <span className="text-base">&#9889;</span>
                  신규 분류 규칙 {newRuleCandidates.filter((c) => !c.confirmed).length}건 확인 필요
                </button>
              )}

              {/* 다운로드 */}
              <button
                onClick={handleDownload}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-sm shadow-lg transition-all active:scale-95"
              >
                &#128229; SmartA10 양식 다운로드 (.xls)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 신규 규칙 확인 모달 */}
      {showNewRuleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="bg-violet-600 p-5 text-white">
              <h2 className="text-lg font-black">신규 분류 규칙 확인</h2>
              <p className="text-violet-200 text-xs font-bold mt-1">
                AI가 새로운 거래처 유형을 발견했습니다. 확정하면 노션 DB에 자동 추가됩니다.
              </p>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {newRuleCandidates.map((candidate, idx) => (
                <div
                  key={idx}
                  className={`border rounded-2xl p-4 space-y-2 ${
                    candidate.confirmed
                      ? "bg-green-50 border-green-200"
                      : "bg-white border-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-700">
                      {candidate.aiResult.tradeName}
                    </span>
                    {candidate.confirmed && (
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                        &#10003; 노션 저장 완료
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400 font-bold">
                    AI 판단: {candidate.aiResult.reasoning}
                  </p>

                  {!candidate.confirmed && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">
                            계정과목 코드
                          </label>
                          <input
                            type="text"
                            value={candidate.editCode}
                            onChange={(e) =>
                              setNewRuleCandidates((prev) =>
                                prev.map((c, j) =>
                                  j === idx ? { ...c, editCode: e.target.value } : c
                                )
                              )
                            }
                            className="w-full border rounded-lg px-2 py-1.5 text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">
                            계정과목명
                          </label>
                          <input
                            type="text"
                            value={candidate.editName}
                            onChange={(e) =>
                              setNewRuleCandidates((prev) =>
                                prev.map((c, j) =>
                                  j === idx ? { ...c, editName: e.target.value } : c
                                )
                              )
                            }
                            className="w-full border rounded-lg px-2 py-1.5 text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">
                            태그
                          </label>
                          <select
                            value={candidate.editTag}
                            onChange={(e) =>
                              setNewRuleCandidates((prev) =>
                                prev.map((c, j) =>
                                  j === idx ? { ...c, editTag: e.target.value } : c
                                )
                              )
                            }
                            className="w-full border rounded-lg px-2 py-1.5 text-xs font-bold"
                          >
                            <option value="매입">매입</option>
                            <option value="일반">일반</option>
                            <option value="전송제외">전송제외</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">
                            거래처 예시 (노션 등록용)
                          </label>
                          <input
                            type="text"
                            value={candidate.editExample}
                            onChange={(e) =>
                              setNewRuleCandidates((prev) =>
                                prev.map((c, j) =>
                                  j === idx ? { ...c, editExample: e.target.value } : c
                                )
                              )
                            }
                            className="w-full border rounded-lg px-2 py-1.5 text-xs font-bold"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">
                          특이사항 (선택)
                        </label>
                        <input
                          type="text"
                          value={candidate.editNote}
                          onChange={(e) =>
                            setNewRuleCandidates((prev) =>
                              prev.map((c, j) =>
                                j === idx ? { ...c, editNote: e.target.value } : c
                              )
                            )
                          }
                          placeholder="조건이나 예외사항 메모"
                          className="w-full border rounded-lg px-2 py-1.5 text-xs"
                        />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => saveNewRule(candidate)}
                          disabled={savingRule}
                          className="flex-1 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-black transition-all disabled:opacity-50"
                        >
                          {savingRule ? "저장 중..." : "&#10003; 확정 (노션 저장)"}
                        </button>
                        <button
                          onClick={() =>
                            setNewRuleCandidates((prev) =>
                              prev.filter((_, j) => j !== idx)
                            )
                          }
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all"
                        >
                          건너뛰기
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t">
              <button
                onClick={() => setShowNewRuleModal(false)}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-xs transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
