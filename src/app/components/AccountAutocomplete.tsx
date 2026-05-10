"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACCOUNT_MASTER, type AccountMasterEntry } from "@/lib/accountMaster";

// ============================================================
// 계정과목 자동완성 — 카드전표/현금영수증 분류 공통
// 입력: 코드(101~999) 또는 계정과목명(부분일치)
// 출력: onSelect(code, name)으로 코드+이름 동시 확정
// ============================================================

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelect: (code: string, name: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** 드롭다운 펼침 방향. 기본 below. */
  dropdownPosition?: "below" | "above";
  /** 드롭다운 최대 표시 개수. 기본 15. */
  maxItems?: number;
}

// 카테고리(구분)에서 사용 영역 라벨 추출
function regionLabel(entry: AccountMasterEntry): string {
  const code = parseInt(entry.code, 10);
  if (code >= 500 && code <= 599) return "제조원가";
  if (code >= 600 && code <= 699) return "도급공사";
  if (code >= 700 && code <= 799) return "분양공사";
  if (code >= 800 && code <= 899) return "판관비";
  if (code >= 900 && code <= 999) return "영업외";
  if (code >= 400 && code <= 499) return "손익";
  if (code >= 300 && code <= 399) return "자본";
  if (code >= 250 && code <= 299) return "부채";
  return "자산";
}

function searchAccounts(q: string, limit: number): AccountMasterEntry[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const isNumeric = /^\d+$/.test(trimmed);

  const exactCode: AccountMasterEntry[] = [];
  const codePrefix: AccountMasterEntry[] = [];
  const exactName: AccountMasterEntry[] = [];
  const namePrefix: AccountMasterEntry[] = [];
  const nameContains: AccountMasterEntry[] = [];

  for (const e of ACCOUNT_MASTER) {
    const nameLower = e.name.toLowerCase();
    if (isNumeric) {
      if (e.code === trimmed) exactCode.push(e);
      else if (e.code.startsWith(trimmed)) codePrefix.push(e);
    } else {
      if (nameLower === lower) exactName.push(e);
      else if (nameLower.startsWith(lower)) namePrefix.push(e);
      else if (nameLower.includes(lower)) nameContains.push(e);
    }
  }

  const merged = [...exactCode, ...exactName, ...namePrefix, ...nameContains, ...codePrefix];
  // 코드 오름차순 보조 정렬(같은 그룹 안에서)
  return merged.slice(0, limit);
}

export default function AccountAutocomplete({
  value,
  onChange,
  onSelect,
  onCancel,
  placeholder = "코드(830) 또는 계정과목명",
  className = "",
  autoFocus = false,
  dropdownPosition = "below",
  maxItems = 15,
}: Props) {
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => searchAccounts(value, maxItems), [value, maxItems]);

  // 강조된 항목으로 스크롤
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const commit = (entry?: AccountMasterEntry) => {
    const target = entry ?? candidates[highlight];
    if (target) {
      onSelect(target.code, target.name);
      setOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (candidates.length > 0) setHighlight((h) => (h + 1) % candidates.length);
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (candidates.length > 0) setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
      setOpen(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (open && candidates.length > 0) setOpen(false);
      else onCancel?.();
    } else if (e.key === "Tab") {
      // Tab은 자동완성 후 다음 필드로 — 후보가 있으면 적용
      if (candidates.length > 0 && open) {
        e.preventDefault();
        commit();
      }
    }
  };

  const dropdownClass =
    dropdownPosition === "above"
      ? "absolute bottom-full mb-1 left-0 right-0 z-30 max-h-64 overflow-auto bg-white border border-blue-200 rounded-xl shadow-lg"
      : "absolute top-full mt-1 left-0 right-0 z-30 max-h-64 overflow-auto bg-white border border-blue-200 rounded-xl shadow-lg";

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 후보 mousedown(preventDefault)이 먼저 실행되므로 blur는 즉시 닫아도 안전
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {open && candidates.length > 0 && (
        <div ref={listRef} className={dropdownClass}>
          {candidates.map((e, idx) => {
            const region = regionLabel(e);
            const isActive = idx === highlight;
            return (
              <button
                key={`${e.code}-${idx}`}
                type="button"
                data-idx={idx}
                onMouseDown={(ev) => {
                  // mousedown — input blur 전에 선택 처리
                  ev.preventDefault();
                  commit(e);
                }}
                onMouseEnter={() => setHighlight(idx)}
                className={`w-full text-left px-3 py-1.5 text-[11px] font-bold flex items-center gap-2 transition-colors ${
                  isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="font-black tabular-nums w-10">{e.code}</span>
                <span className="flex-1 truncate">{e.name}</span>
                <span className="text-[9px] text-slate-400 font-bold">{region}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
