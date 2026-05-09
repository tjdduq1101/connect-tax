"use client";
import React, { useState, useMemo, useRef, useEffect } from "react";
import bizCodeData from "@/app/data/bizCodeData.json";

type BizCode = {
  code: string;
  industry: string;
  label: string;
  simpleRate: number;
  standardRate: number;
};

type AccountItem = {
  id: string;
  name: string;
  checked: boolean;
  ratio: string; // 입력값 (문자열 %)
  isRemainder: boolean; // 나머지 항목 여부
  minRatio: number;
  maxRatio: number;
};

const DEFAULT_ITEMS: Omit<AccountItem, "checked" | "ratio">[] = [
  { id: "travel", name: "여비교통비", isRemainder: false, minRatio: 10, maxRatio: 15 },
  { id: "entertainment", name: "접대비", isRemainder: false, minRatio: 15, maxRatio: 20 },
  { id: "communication", name: "통신비", isRemainder: false, minRatio: 1, maxRatio: 2 },
  { id: "books", name: "도서인쇄비", isRemainder: false, minRatio: 0.5, maxRatio: 1.5 },
  { id: "office", name: "사무용품비", isRemainder: false, minRatio: 1, maxRatio: 3 },
  { id: "supplies", name: "소모품비", isRemainder: false, minRatio: 20, maxRatio: 25 },
  { id: "fees", name: "지급수수료", isRemainder: true, minRatio: 0, maxRatio: 100 },
  { id: "advertising", name: "광고선전비", isRemainder: false, minRatio: 5, maxRatio: 10 },
];

const formatMoney = (n: number) => Math.floor(n).toLocaleString();
const parseNum = (s: string) => Number(s.replace(/,/g, "")) || 0;
const formatInput = (value: string) => {
  const raw = value.replace(/[^0-9]/g, "");
  return raw ? Number(raw).toLocaleString() : "";
};

function getAdjustedExpense(totalIncome: number, totalExpense: number): number {
  if (totalIncome <= 50_000_000) return totalExpense * 0.98;
  if (totalIncome <= 75_000_000) return totalExpense * 0.9;
  return totalExpense * 0.8;
}

function getAdjustFactor(totalIncome: number): number {
  if (totalIncome <= 50_000_000) return 0.98;
  if (totalIncome <= 75_000_000) return 0.9;
  return 0.8;
}

export default function IncomeExpenseDistributor({ onBack }: { onBack: () => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBiz, setSelectedBiz] = useState<BizCode | null>(null);
  const [rateType, setRateType] = useState<"simple" | "standard">("simple");
  const [incomeInput, setIncomeInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [items, setItems] = useState<AccountItem[]>(() =>
    DEFAULT_ITEMS.map((d) => ({ ...d, checked: true, ratio: "" }))
  );
  const [result, setResult] = useState<{ name: string; amount: number }[] | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCodes = useMemo<BizCode[]>(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) return [];
    const isCode = /^\d+$/.test(q);
    const results = (bizCodeData as BizCode[]).filter((d) =>
      isCode ? d.code.startsWith(q) : d.label.includes(q) || d.industry.includes(q)
    );
    return results.slice(0, 20);
  }, [searchQuery]);

  const selectedRate =
    selectedBiz
      ? rateType === "simple"
        ? selectedBiz.simpleRate
        : selectedBiz.standardRate
      : null;

  const totalIncome = parseNum(incomeInput);
  const totalExpense = selectedRate != null ? totalIncome * selectedRate : 0;
  const adjustedExpense = totalIncome > 0 ? getAdjustedExpense(totalIncome, totalExpense) : 0;
  const adjustFactor = getAdjustFactor(totalIncome);
  const targetRate = selectedRate != null && totalIncome > 0
    ? selectedRate * adjustFactor * 100
    : 0;

  // 체크된 항목들의 비율 합산 (나머지 항목 제외) — 소득금액 대비 비율
  const checkedItems = items.filter((it) => it.checked);
  const nonRemainderChecked = checkedItems.filter((it) => !it.isRemainder);
  const sumRatio = nonRemainderChecked.reduce((acc, it) => acc + (parseFloat(it.ratio) || 0), 0);
  const remainderItem = items.find((it) => it.isRemainder && it.checked);
  const remainderRatio = remainderItem ? Math.max(0, targetRate - sumRatio) : 0;
  const isOverTarget = sumRatio > targetRate;

  function handleSelectBiz(biz: BizCode) {
    setSelectedBiz(biz);
    setSearchQuery(`${biz.code} - ${biz.label}`);
    setShowDropdown(false);
    setResult(null);
  }

  function handleSearchChange(v: string) {
    setSearchQuery(v);
    setSelectedBiz(null);
    setShowDropdown(true);
    setResult(null);
  }

  function handleToggleItem(id: string) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, checked: !it.checked, ratio: "" } : it))
    );
    setResult(null);
  }

  function handleRatioChange(id: string, value: string) {
    const clean = value.replace(/[^0-9.]/g, "");
    const parts = clean.split(".");
    const normalized = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : clean;
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ratio: normalized } : it)));
    setResult(null);
  }

  function handleRandomFill() {
    if (targetRate === 0) return;
    const scale = targetRate / 100;
    setItems((prev) =>
      prev.map((it) => {
        if (!it.checked || it.isRemainder) return { ...it, ratio: "" };
        const scaledMin = it.minRatio * scale;
        const scaledMax = it.maxRatio * scale;
        const rand = Math.round((Math.random() * (scaledMax - scaledMin) + scaledMin) * 10) / 10;
        return { ...it, ratio: String(rand) };
      })
    );
    setResult(null);
  }

  function handleCalculate() {
    if (!selectedBiz) { alert("업종코드를 선택해주세요."); return; }
    if (totalIncome === 0) { alert("소득금액을 입력해주세요."); return; }
    if (checkedItems.length === 0) { alert("계정과목을 하나 이상 선택해주세요."); return; }
    if (isOverTarget) { alert("비율 합계가 목표 경비율을 초과했습니다."); return; }

    const resultData = checkedItems.map((it) => {
      const ratio = it.isRemainder
        ? remainderRatio / 100
        : (parseFloat(it.ratio) || 0) / 100;
      return { name: it.name, amount: Math.floor(totalIncome * ratio) };
    });
    setResult(resultData);
  }

  const totalResult = result ? result.reduce((s, r) => s + r.amount, 0) : 0;

  return (
    <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={onBack}
        className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors"
      >
        &#8592; 돌아가기
      </button>

      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* 헤더 */}
        <div className="bg-purple-600 p-8 text-center text-white">
          <h1 className="text-2xl font-black mb-1">사업소득 비용 자동 분배</h1>
          <p className="text-purple-100 text-xs font-bold uppercase tracking-widest opacity-80">
            Connect Tax Services
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* ── STEP 1: 업종코드 ── */}
          <section>
            <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-3">
              Step 1 · 업종코드
            </h2>
            <div className="relative" ref={dropdownRef}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => searchQuery.length >= 2 && setShowDropdown(true)}
                placeholder="업종코드 또는 업종명 검색 (2자 이상)"
                className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-purple-400"
              />
              {showDropdown && filteredCodes.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                  {filteredCodes.map((biz) => (
                    <button
                      key={biz.code}
                      onClick={() => handleSelectBiz(biz)}
                      className="w-full text-left px-4 py-2.5 hover:bg-purple-50 transition-colors border-b border-slate-50 last:border-0"
                    >
                      <span className="text-xs font-black text-purple-600 mr-2">{biz.code}</span>
                      <span className="text-xs font-bold text-slate-700">{biz.label}</span>
                      <span className="text-[10px] text-slate-400 ml-1">({biz.industry})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedBiz && (
              <div className="mt-3 space-y-2 animate-in fade-in duration-200">
                {/* 경비율 유형 선택 */}
                <div className="flex gap-2">
                  {(["simple", "standard"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => { setRateType(type); setResult(null); }}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2 ${
                        rateType === type
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-slate-100 text-slate-400"
                      }`}
                    >
                      {type === "simple" ? "단순경비율" : "기준경비율"}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between items-center bg-slate-50 rounded-xl p-3">
                  <span className="text-xs font-bold text-slate-500">{selectedBiz.label}</span>
                  <span className="text-lg font-black text-purple-600">
                    {selectedRate != null ? `${(selectedRate * 100).toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* ── STEP 2: 소득금액 ── */}
          <section>
            <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-3">
              Step 2 · 소득금액
            </h2>
            <div className="relative group">
              <input
                type="text"
                value={incomeInput}
                onChange={(e) => { setIncomeInput(formatInput(e.target.value)); setResult(null); }}
                placeholder="0"
                className="w-full p-4 pr-10 bg-slate-50 border-none rounded-xl text-2xl font-black text-right outline-none focus:ring-2 focus:ring-purple-400"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-300 group-focus-within:text-purple-400">
                원
              </span>
            </div>

            {totalIncome > 0 && selectedRate != null && (
              <div className="mt-3 bg-slate-50 rounded-xl p-4 space-y-1.5 animate-in fade-in duration-200">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-500">총 필요경비 (소득 × 경비율)</span>
                  <span className="text-slate-700">{formatMoney(totalExpense)}원</span>
                </div>
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-500">
                    소득 구간 보정 (×{adjustFactor})
                    <span className="ml-1 text-slate-400">
                      {totalIncome <= 50_000_000
                        ? "5천만 이하"
                        : totalIncome <= 75_000_000
                        ? "7.5천만 이하"
                        : "7.5천만 초과"}
                    </span>
                  </span>
                  <span className="text-purple-600 font-black">{formatMoney(adjustedExpense)}원</span>
                </div>
              </div>
            )}
          </section>

          {/* ── STEP 3: 계정과목 선택 ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                Step 3 · 계정과목 선택 및 비율
              </h2>
              <button
                onClick={handleRandomFill}
                className="text-[11px] font-black text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                랜덤 채우기
              </button>
            </div>

            <div className="space-y-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    it.checked ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={it.checked}
                    onChange={() => handleToggleItem(it.id)}
                    className="w-4 h-4 accent-purple-600 cursor-pointer shrink-0"
                  />
                  <span className="text-sm font-bold text-slate-700 flex-1">{it.name}</span>

                  {it.isRemainder ? (
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-black text-slate-400">
                        {it.checked ? `${remainderRatio.toFixed(1)}%` : "—"}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">(나머지)</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={it.ratio}
                        onChange={(e) => handleRatioChange(it.id, e.target.value)}
                        disabled={!it.checked}
                        placeholder={targetRate > 0
                          ? `${(it.minRatio * targetRate / 100).toFixed(1)}~${(it.maxRatio * targetRate / 100).toFixed(1)}`
                          : `${it.minRatio}~${it.maxRatio}`
                        }
                        className="w-20 p-2 text-right text-sm font-bold bg-slate-50 rounded-lg outline-none focus:ring-2 focus:ring-purple-400 disabled:opacity-40"
                      />
                      <span className="text-sm font-bold text-slate-400">%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 비율 합계 — 소득금액 대비 */}
            <div className="mt-3 space-y-1.5">
              {/* 진행 바 */}
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isOverTarget ? "bg-red-400" : targetRate > 0 && sumRatio >= targetRate * 0.9 ? "bg-green-400" : "bg-purple-400"
                  }`}
                  style={{ width: `${targetRate > 0 ? Math.min((sumRatio / targetRate) * 100, 100) : 0}%` }}
                />
              </div>
              <div
                className={`flex justify-between items-center px-1 text-xs font-black transition-colors ${
                  isOverTarget ? "text-red-500" : "text-slate-500"
                }`}
              >
                <span>
                  {isOverTarget ? (
                    <span className="text-red-500">⚠️ 목표 초과 — {(sumRatio - targetRate).toFixed(1)}% 줄여야 합니다</span>
                  ) : remainderItem?.checked ? (
                    <span>
                      직접 입력 <span className="text-purple-600">{sumRatio.toFixed(1)}%</span>
                      {" "}· {remainderItem.name}{" "}
                      <span className={remainderRatio < 0 ? "text-red-500" : "text-slate-600"}>
                        {remainderRatio.toFixed(1)}%
                      </span>{" "}
                      (나머지 자동)
                    </span>
                  ) : (
                    <span>
                      합계 <span className="text-purple-600">{sumRatio.toFixed(1)}%</span>
                      {" "}· 미배분{" "}
                      <span className={targetRate - sumRatio < 0 ? "text-red-500" : "text-slate-600"}>
                        {(targetRate - sumRatio).toFixed(1)}%
                      </span>
                    </span>
                  )}
                </span>
                <span className="text-slate-400">/ {targetRate.toFixed(1)}%</span>
              </div>
            </div>
          </section>

          {/* 계산 버튼 */}
          <button
            onClick={handleCalculate}
            disabled={!selectedBiz || totalIncome === 0 || checkedItems.length === 0 || isOverTarget}
            className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-2xl font-black text-lg shadow-lg transition-all active:scale-95"
          >
            분배 계산하기
          </button>

          {/* 결과 */}
          {result && (
            <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black text-[10px] uppercase">
                    <tr>
                      <th className="p-3 text-left">계정과목</th>
                      <th className="p-3 text-right">비율</th>
                      <th className="p-3 text-right">금액</th>
                    </tr>
                  </thead>
                  <tbody className="font-bold text-slate-700">
                    {result.map((row, i) => {
                      const matchedItem = items.find((it) => it.name === row.name);
                      const ratio = matchedItem?.isRemainder
                        ? remainderRatio
                        : parseFloat(matchedItem?.ratio ?? "0") || 0;
                      return (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="p-3 text-slate-600">{row.name}</td>
                          <td className="p-3 text-right text-slate-400 text-xs">{ratio.toFixed(1)}%</td>
                          <td className="p-3 text-right text-blue-600">{formatMoney(row.amount)}원</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-6 bg-gradient-to-br from-purple-600 to-purple-800 rounded-2xl text-center shadow-xl">
                <p className="text-purple-100 text-xs mb-1 font-bold tracking-widest uppercase">
                  분배 비용 합계
                </p>
                <p className="text-3xl font-black text-white">{formatMoney(totalResult)}원</p>
                <p className="text-purple-200 text-[10px] mt-2 font-bold">
                  조정 총 경비 {formatMoney(adjustedExpense)}원 기준
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
