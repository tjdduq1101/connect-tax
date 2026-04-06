"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import {
  classifyTransaction,
  ACCOUNT_NAME_TO_CODE,
  type TransactionRow,
  type BusinessConditions,
  type ClassificationResult,
} from "@/lib/accountClassifier";

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

interface ClassifiedRow {
  input: InputRow;
  result: ClassificationResult;
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

function classifyAll(
  rows: InputRow[],
  conditions: BusinessConditions
): ClassifiedRow[] {
  return rows.map((input) => {
    const txRow: TransactionRow = {
      tradeName: input.거래처,
      businessType: input.업태,
      sector: input.종목,
      amount: input.합계,
      ntsStatus: input.국세청,
      taxType: input.유형,
    };
    const result = classifyTransaction(txRow, conditions);
    return { input, result };
  });
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
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // 필터
  const [filter, setFilter] = useState<"all" | "review" | "exclude">("all");

  const handleFile = async (file: File) => {
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
      const results = classifyAll(rows, conditions);
      setClassified(results);
    } catch {
      setError("파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleReClassify = () => {
    if (classified.length === 0) return;
    const rows = classified.map((c) => c.input);
    const results = rows.map((input) => {
      const txRow: TransactionRow = {
        tradeName: input.거래처,
        businessType: input.업태,
        sector: input.종목,
        amount: input.합계,
        ntsStatus: input.국세청,
        taxType: input.유형,
      };
      return { input, result: classifyTransaction(txRow, conditions) };
    });
    setClassified(results);
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
  const lowCount = classified.filter((c) => c.result.confidence === "low").length;
  const excludeCount = classified.filter((c) => c.result.tag === "전송제외").length;

  // 필터된 목록
  const filteredRows = classified.filter((c) => {
    if (filter === "review") return c.result.confidence === "low" || c.result.confidence === "medium";
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
              <div className="flex items-center justify-center gap-2 text-slate-500 font-bold text-sm">
                <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                분류 중...
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
                <div className="p-3 rounded-xl bg-green-50 text-center">
                  <p className="text-lg font-black text-green-600">{highCount}</p>
                  <p className="text-[10px] font-bold text-green-500">자동분류</p>
                </div>
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
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-400 font-bold text-[10px] uppercase sticky top-0">
                      <tr>
                        <th className="p-2 text-left w-8">#</th>
                        <th className="p-2 text-left">거래처</th>
                        <th className="p-2 text-right">합계</th>
                        <th className="p-2 text-center">코드</th>
                        <th className="p-2 text-left">계정과목</th>
                        <th className="p-2 text-center">태그</th>
                        <th className="p-2 text-center">신뢰도</th>
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {filteredRows.map((c, i) => {
                        const isLow = c.result.confidence === "low";
                        const isMedium = c.result.confidence === "medium";
                        const isExclude = c.result.tag === "전송제외";
                        const rowBg = isLow
                          ? "bg-red-50"
                          : isMedium
                          ? "bg-amber-50"
                          : isExclude
                          ? "bg-slate-50"
                          : "";
                        const tagColor =
                          c.result.tag === "매입"
                            ? "bg-purple-100 text-purple-700"
                            : c.result.tag === "일반"
                            ? "bg-slate-100 text-slate-600"
                            : c.result.tag === "전송제외"
                            ? "bg-red-100 text-red-600"
                            : "bg-slate-100 text-slate-500";
                        const confColor =
                          c.result.confidence === "high"
                            ? "text-green-500"
                            : c.result.confidence === "medium"
                            ? "text-amber-500"
                            : "text-red-500";

                        return (
                          <tr
                            key={i}
                            className={`border-t border-slate-50 ${rowBg}`}
                          >
                            <td className="p-2 text-slate-300">
                              {classified.indexOf(c) + 1}
                            </td>
                            <td className="p-2 max-w-[180px] truncate">
                              {c.input.거래처}
                            </td>
                            <td className="p-2 text-right text-slate-500">
                              {c.input.합계.toLocaleString()}
                            </td>
                            <td className="p-2 text-center font-black">
                              {c.result.code || "-"}
                            </td>
                            <td className="p-2">
                              {c.result.name || "-"}
                              {c.result.note && (
                                <span className="block text-[9px] text-slate-400 font-normal truncate max-w-[120px]">
                                  {c.result.note}
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              {c.result.tag && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${tagColor}`}
                                >
                                  {c.result.tag}
                                </span>
                              )}
                            </td>
                            <td className={`p-2 text-center text-[10px] ${confColor}`}>
                              {c.result.confidence === "high"
                                ? "●"
                                : c.result.confidence === "medium"
                                ? "◐"
                                : "○"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 범례 */}
              <div className="flex gap-3 text-[10px] text-slate-400 font-bold justify-center">
                <span className="flex items-center gap-1">
                  <span className="text-green-500">●</span> PDF규칙
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-amber-500">◐</span> 카테고리추정
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-red-500">○</span> 미분류
                </span>
              </div>

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
    </div>
  );
}
