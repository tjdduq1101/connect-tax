"use client";
import React, { useState } from 'react';
import taxData from './data/taxData.json';
import BusinessLookup from './components/BusinessLookup';
import AccountRecommend from './components/AccountRecommend';
import CashReceiptClassifier from './components/CashReceiptClassifier';
import DbUpload from './components/DbUpload';
import BusinessInfoUpload from './components/BusinessInfoUpload';
import BizStatusBulkChecker from './components/BizStatusBulkChecker';

// --- [공통 함수] ---
const format = (n: number) => Math.floor(n).toLocaleString();
const floor10 = (value: number) => Math.floor(value / 10) * 10;
const parseNum = (s: string) => Number(s.replace(/,/g, '')) || 0;
const formatInput = (value: string) => {
  const raw = value.replace(/[^0-9]/g, '');
  return raw ? Number(raw).toLocaleString() : '';
};

// --- 공통 UI ---
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors">
      &#8592; 돌아가기
    </button>
  );
}

function CalcHeader({ title }: { title: string }) {
  return (
    <div className="bg-blue-600 p-8 text-center text-white">
      <h1 className="text-2xl font-black mb-1">{title}</h1>
      <p className="text-blue-100 text-xs font-bold uppercase tracking-widest opacity-80">Connect Tax Services</p>
    </div>
  );
}

function MoneyInput({ label, value, onChange, placeholder = "0", large = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; large?: boolean }) {
  return (
    <div>
      {label && <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-1">{label}</label>}
      <div className="relative group">
        <input type="text" value={value} onChange={(e) => onChange(formatInput(e.target.value))} placeholder={placeholder}
          className={`w-full ${large ? 'p-5 text-3xl' : 'p-3 text-sm'} pr-10 bg-slate-50 border-none rounded-xl font-bold text-right outline-none focus:ring-2 focus:ring-blue-400 transition-all`} />
        <span className={`absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-300 group-focus-within:text-blue-400 ${large ? 'text-lg' : 'text-sm'}`}>원</span>
      </div>
    </div>
  );
}

// =============================================
// 1. 급여 일할 계산기
// =============================================
function SalaryCalc({ onBack }: { onBack: () => void }) {
  const [inputs, setInputs] = useState({ base: '', meal: '', car: '', child: '', overtime: '', etc: '' });
  const [date, setDate] = useState('');
  const [type, setType] = useState<'입사' | '퇴사'>('입사');
  const [displayResult, setDisplayResult] = useState<{ total: number; details: { label: string; value: number }[] } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setInputs(prev => ({ ...prev, [name]: formatInput(value) }));
    setDisplayResult(null);
  };

  const handleCalculate = () => {
    if (!date) { alert("날짜를 선택해주세요!"); return; }
    const selectedDate = new Date(date);
    const totalDays = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    const workedDays = type === '입사' ? totalDays - selectedDate.getDate() + 1 : selectedDate.getDate();
    const labels: Record<string, string> = { base: '기본급', meal: '식대', car: '자가운전 보조금', child: '육아 수당', overtime: '연장 수당', etc: '기타 수당' };
    const details = Object.entries(inputs).map(([key, val]) => {
      const calculated = Math.floor((parseNum(val) / totalDays) * workedDays);
      return { label: labels[key], value: calculated };
    }).filter(item => item.value > 0);
    setDisplayResult({ total: details.reduce((sum, item) => sum + item.value, 0), details });
  };

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <BackButton onClick={onBack} />
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <CalcHeader title="급여 일할 계산기" />
        <div className="p-8">
          <div className="flex mb-6 p-1.5 bg-slate-100 rounded-2xl">
            {(['입사', '퇴사'] as const).map((t) => (
              <button key={t} onClick={() => { setType(t); setDisplayResult(null); }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${type === t ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500'}`}>{t}자 계산</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            {[{ id: 'base', label: '기본급' }, { id: 'meal', label: '식대' }, { id: 'car', label: '자가운전 보조금' }, { id: 'child', label: '육아 수당' }, { id: 'overtime', label: '연장 수당' }, { id: 'etc', label: '기타 수당' }].map(item => (
              <div key={item.id}>
                <label className="text-[11px] font-bold text-slate-400 ml-1 mb-1 block">{item.label}</label>
                <input type="text" name={item.id} value={(inputs as Record<string, string>)[item.id]} onChange={handleChange}
                  className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-400" placeholder="0" />
              </div>
            ))}
          </div>
          <div className="mb-6">
            <label className="text-[11px] font-bold text-slate-400 ml-1 mb-1 block">{type} 일자 선택</label>
            <input type="date" onChange={(e) => { setDate(e.target.value); setDisplayResult(null); }}
              className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button onClick={handleCalculate} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg transition-transform active:scale-95">계산하기</button>
          {displayResult && (
            <div className="space-y-4 mt-6 animate-in slide-in-from-bottom-2 duration-300">
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                {displayResult.details.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm py-1"><span className="text-slate-600 font-medium">{item.label}</span><span className="text-slate-900 font-bold">{format(item.value)}원</span></div>
                ))}
              </div>
              <div className="p-7 bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl text-center shadow-xl">
                <p className="text-blue-100 text-xs mb-1 font-bold tracking-widest uppercase">{type}월 총 지급액</p>
                <p className="text-3xl font-black text-white">{format(displayResult.total)}원</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================
// 2. 프리랜서(3.3%) 계산기
// =============================================
function FreelancerCalc({ onBack }: { onBack: () => void }) {
  const [viewMode, setViewMode] = useState<'single' | 'bulk'>('single');
  const [mode, setMode] = useState<'before' | 'after'>('before');
  const [inputValue, setInputValue] = useState('');
  const [bulkMode, setBulkMode] = useState<'before' | 'after'>('before');
  const [bulkEntries, setBulkEntries] = useState([{ name: '', amount: '' }]);
  const [bulkResults, setBulkResults] = useState<{ name: string; before: number; incomeTax: number; localTax: number; totalTax: number; after: number }[]>([]);
  const calculateTaxes = (beforeAmt: number) => {
    const incomeTax = Math.floor((beforeAmt * 0.03) / 10) * 10;
    const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
    const totalTax = incomeTax + localTax;
    return { before: beforeAmt, incomeTax, localTax, totalTax, after: beforeAmt - totalTax };
  };

  const findGoalSeekBefore = (targetAfter: number) => {
    if (targetAfter === 0) return 0;
    const estimate = Math.floor(targetAfter / 0.967);
    for (let i = -100; i <= 100; i++) {
      const res = calculateTaxes(estimate + i);
      if (res.after === targetAfter) return estimate + i;
    }
    return estimate;
  };

  const addBulkEntry = () => setBulkEntries(prev => [...prev, { name: '', amount: '' }]);
  const removeBulkEntry = (idx: number) => { if (bulkEntries.length > 1) setBulkEntries(prev => prev.filter((_, i) => i !== idx)); };
  const updateBulkEntry = (idx: number, field: 'name' | 'amount', value: string) => {
    setBulkEntries(prev => {
      const updated = prev.map((e, i) => i === idx ? { ...e, [field]: field === 'amount' ? formatInput(value) : value } : e);
      const last = updated[updated.length - 1];
      if (idx === updated.length - 1 && last.name.trim() !== '' && last.amount.trim() !== '') {
        return [...updated, { name: '', amount: '' }];
      }
      return updated;
    });
    setBulkResults([]);
  };

  const handleBulkCalculate = () => {
    const valid = bulkEntries.filter(e => e.amount.trim() !== '');
    if (valid.length === 0) { alert("금액을 입력해주세요."); return; }
    setBulkResults(valid.map(e => {
      const num = parseNum(e.amount);
      const before = bulkMode === 'before' ? num : findGoalSeekBefore(num);
      const res = calculateTaxes(before);
      return { name: e.name, ...res, after: bulkMode === 'before' ? res.after : num };
    }));
  };

  const currentNum = parseNum(inputValue);
  const singleResult = mode === 'before' ? calculateTaxes(currentNum) : calculateTaxes(findGoalSeekBefore(currentNum));

  return (
    <div className={`w-full ${viewMode === 'bulk' ? 'max-w-4xl' : 'max-w-md'} transition-all animate-in fade-in slide-in-from-bottom-4 duration-500`}>
      <BackButton onClick={onBack} />
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <CalcHeader title="프리랜서(3.3%) 계산기" />
        <div className="flex p-2 bg-slate-50 border-b border-slate-100">
          {(['single', 'bulk'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${viewMode === v ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              {v === 'single' ? '개별 정산' : '대량 일괄 정산'}
            </button>
          ))}
        </div>
        <div className="p-8">
          {viewMode === 'single' ? (
            <div className="space-y-6">
              <div className="flex gap-3">
                {(['before', 'after'] as const).map(m => (
                  <button key={m} onClick={() => { setMode(m); setInputValue(''); }}
                    className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${mode === m ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-100 text-slate-400'}`}>
                    {m === 'before' ? '세전 입력' : '실수령 역산'}
                  </button>
                ))}
              </div>
              <MoneyInput label="" value={inputValue} onChange={setInputValue} large />
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-3">
                <div className="flex justify-between text-sm font-bold text-slate-500"><span>세전 금액</span><span className="text-slate-900">{format(singleResult.before)}원</span></div>
                <div className="flex justify-between text-xs font-bold text-rose-400"><span>&#9492; 소득세(3%)</span><span>{format(singleResult.incomeTax)}원</span></div>
                <div className="flex justify-between text-xs font-bold text-rose-400"><span>&#9492; 지방세(0.3%)</span><span>{format(singleResult.localTax)}원</span></div>
                <div className="h-px bg-slate-200 my-4" />
                <div className="flex justify-between items-center">
                  <span className="font-black text-slate-700">{mode === 'before' ? '최종 실수령액' : '신고 세전금액'}</span>
                  <span className="text-2xl font-black text-blue-600">{format(mode === 'before' ? singleResult.after : singleResult.before)}원</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex gap-3">
                {(['before', 'after'] as const).map(m => (
                  <button key={m} onClick={() => { setBulkMode(m); setBulkResults([]); }}
                    className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${bulkMode === m ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-100 text-slate-400'}`}>
                    {m === 'before' ? '세전 입력' : '실수령 역산'}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1">
                  <span className="text-[10px] font-bold text-slate-400 ml-1">이름</span>
                  <span className="text-[10px] font-bold text-slate-400 ml-1">{bulkMode === 'before' ? '세전 금액' : '실수령액'}</span>
                  <span />
                </div>
                {bulkEntries.map((entry, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="text"
                      value={entry.name}
                      onChange={(e) => updateBulkEntry(idx, 'name', e.target.value)}
                      placeholder="홍길동"
                      className="p-3 bg-slate-50 border-none rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <div className="relative">
                      <input
                        type="text"
                        value={entry.amount}
                        onChange={(e) => updateBulkEntry(idx, 'amount', e.target.value)}
                        placeholder="0"
                        className="w-full p-3 pr-8 bg-slate-50 border-none rounded-xl text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-300">원</span>
                    </div>
                    <button onClick={() => removeBulkEntry(idx)} className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-colors ${bulkEntries.length > 1 ? 'text-slate-300 hover:text-rose-400' : 'text-slate-100 cursor-default'}`}>✕</button>
                  </div>
                ))}
                <button onClick={addBulkEntry} className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm font-bold text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-all">+ 행 추가</button>
              </div>
              <button onClick={handleBulkCalculate} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-transform">일괄 계산하기</button>
              {bulkResults.length > 0 && (
                <div className="mt-4 border rounded-2xl overflow-hidden overflow-x-auto animate-in slide-in-from-bottom-2 duration-300">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-slate-50 text-slate-400 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-4 text-left">이름</th>
                        <th className="p-4">세전금액</th>
                        <th className="p-4 text-rose-400">소득세</th>
                        <th className="p-4 text-rose-400">지방세</th>
                        <th className="p-4 text-blue-600">실수령액</th>
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {bulkResults.map((res, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-4 text-left text-slate-600">{res.name || '-'}</td>
                          <td className="p-4">{format(res.before)}원</td>
                          <td className="p-4 text-rose-300">{format(res.incomeTax)}원</td>
                          <td className="p-4 text-rose-300">{format(res.localTax)}원</td>
                          <td className="p-4 text-blue-600 bg-blue-50/30">{format(res.after)}원</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================
// 3. 2026년 연봉 계산기
// =============================================
function RegularSalaryCalc({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'before' | 'after'>('before');
  const [inputValue, setInputValue] = useState('');
  const [taxFreeInput, setTaxFreeInput] = useState('');
  const [familyCount, setFamilyCount] = useState(1);
  const [isSpecialRelation, setIsSpecialRelation] = useState(false);
  const [calculatedResult, setCalculatedResult] = useState<{ total: number; np: number; hi: number; lt: number; ei: number; it: number; local: number; totalDeduction: number; after: number } | null>(null);

  const getIncomeTax = (taxable: number, family: number) => {
    if (taxable < 1060000) return 0;
    const fKey = `f${Math.min(family, 4)}`;
    if (taxable <= 10000000) {
      const row = [...taxData].reverse().find(d => taxable >= d.min);
      return row ? (row as Record<string, number>)[fKey] || 0 : 0;
    } else {
      const t10Row = taxData.find(d => d.min === 10000000);
      const t10Base = t10Row ? (t10Row as Record<string, number>)[fKey] : 0;
      let extraTax = 0;
      if (taxable <= 14000000) extraTax = ((taxable - 10000000) * 0.98 * 0.35) + 25000;
      else if (taxable <= 28000000) extraTax = 1397000 + ((taxable - 14000000) * 0.98 * 0.38);
      else if (taxable <= 30000000) extraTax = 6610600 + ((taxable - 28000000) * 0.98 * 0.4);
      else if (taxable <= 45000000) extraTax = 7394600 + ((taxable - 30000000) * 0.4);
      else if (taxable <= 87000000) extraTax = 13394600 + ((taxable - 45000000) * 0.42);
      else extraTax = 31034600 + ((taxable - 87000000) * 0.45);
      return Math.floor((t10Base + extraTax) / 10) * 10;
    }
  };

  const calculateDeductions = (taxableAmt: number, taxFreeAmt: number) => {
    const np = Math.min(302575, floor10(taxableAmt * 0.0475));
    const hi = floor10(taxableAmt * 0.03595);
    const lt = floor10(hi * 0.1314);
    const ei = isSpecialRelation ? 0 : floor10(taxableAmt * 0.009);
    const it = getIncomeTax(taxableAmt, familyCount);
    const local = floor10(it * 0.1);
    const totalDeduction = np + hi + lt + ei + it + local;
    const total = taxableAmt + taxFreeAmt;
    return { total, np, hi, lt, ei, it, local, totalDeduction, after: total - totalDeduction };
  };

  const findGoalSeekGross = (targetNet: number, taxFreeAmt: number) => {
    if (targetNet === 0) return calculateDeductions(0, 0);
    let low = 0, high = targetNet * 2, bestTaxable = 0, minDiff = Infinity;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const res = calculateDeductions(mid, taxFreeAmt);
      const diff = res.after - targetNet;
      if (Math.abs(diff) < minDiff) { minDiff = Math.abs(diff); bestTaxable = mid; }
      if (diff === 0) break;
      else if (diff > 0) high = mid - 1;
      else low = mid + 1;
    }
    return calculateDeductions(Math.floor(bestTaxable / 10) * 10, taxFreeAmt);
  };

  const handleFinalCalculate = () => {
    const currentInput = parseNum(inputValue);
    const currentTaxFree = parseNum(taxFreeInput);
    if (currentInput === 0) { alert("금액을 입력해주세요."); return; }
    setCalculatedResult(mode === 'before' ? calculateDeductions(currentInput, currentTaxFree) : findGoalSeekGross(currentInput, currentTaxFree));
  };

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <BackButton onClick={onBack} />
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <CalcHeader title="2026년 연봉 계산기" />
        <div className="p-8 space-y-6">
          <div className="flex gap-3">
            {(['before', 'after'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setInputValue(''); setCalculatedResult(null); }}
                className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${mode === m ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-100 text-slate-400'}`}>
                {m === 'before' ? '세전 급여 입력' : '실수령 역산'}
              </button>
            ))}
          </div>
          <MoneyInput label={mode === 'before' ? '월 과세 급여액 (세전)' : '원하는 목표 실수령액'} value={inputValue} onChange={(v) => { setInputValue(v); setCalculatedResult(null); }} large />
          <MoneyInput label="월 비과세 급여액 (식대 등)" value={taxFreeInput} onChange={(v) => { setTaxFreeInput(v); setCalculatedResult(null); }} />
          <div>
            <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-2">공제대상 가족수 (본인 포함)</label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => { setFamilyCount(n); setCalculatedResult(null); }}
                  className={`py-2 rounded-xl text-sm font-bold transition-all ${familyCount === n ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>{n}인</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-bold text-slate-500">고용보험 가입 제외 (대표자 등)</span>
            <input type="checkbox" checked={isSpecialRelation} onChange={(e) => { setIsSpecialRelation(e.target.checked); setCalculatedResult(null); }} className="w-5 h-5 accent-blue-600 cursor-pointer" />
          </div>
          <button onClick={handleFinalCalculate} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg transition-all active:scale-95">계산하기</button>
          {calculatedResult && (
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-3 animate-in fade-in zoom-in duration-300">
              <div className="flex justify-between text-sm font-bold text-slate-500"><span>세전 총액 (과세+비과세)</span><span className="text-slate-900">{format(calculatedResult.total)}원</span></div>
              {[{ l: '국민연금', v: calculatedResult.np, c: 'text-slate-400' }, { l: '건강보험', v: calculatedResult.hi, c: 'text-slate-400' }, { l: '장기요양', v: calculatedResult.lt, c: 'text-slate-400' }, { l: '고용보험', v: calculatedResult.ei, c: 'text-slate-400' }, { l: '소득세', v: calculatedResult.it, c: 'text-rose-400' }, { l: '지방소득세', v: calculatedResult.local, c: 'text-rose-400' }].map((item, i) => (
                <div key={i} className={`flex justify-between text-xs font-bold ${item.c}`}><span>&#9492; {item.l}</span><span>{format(item.v)}원</span></div>
              ))}
              <div className="h-px bg-slate-200 my-4" />
              <div className="flex justify-between items-center">
                <span className="font-black text-slate-700">{mode === 'before' ? '최종 실수령액' : '필요한 세전 총액'}</span>
                <span className="text-2xl font-black text-blue-600">{format(mode === 'before' ? calculatedResult.after : calculatedResult.total)}원</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================
// 4. 통상임금 산출 및 수당 계산기 (통합)
// =============================================
function WageAndAllowanceCalc({ onBack }: { onBack: () => void }) {
  const [subTab, setSubTab] = useState<'ordinary' | 'annual' | 'overtime'>('ordinary');

  // --- 통상임금 state ---
  const [basePay, setBasePay] = useState('');
  const [fixedAllowance, setFixedAllowance] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('40');
  const [includeWeeklyHoliday, setIncludeWeeklyHoliday] = useState(true);
  const [ordinaryResult, setOrdinaryResult] = useState<{ monthlyOrdinary: number; weeklyPaidHours: number; monthlyHours: number; hourlyWage: number; dailyWage: number } | null>(null);

  // --- 연차수당 state ---
  const [annualHourlyWage, setAnnualHourlyWage] = useState('');
  const [dailyHours, setDailyHours] = useState('8');
  const [customDailyHours, setCustomDailyHours] = useState('');
  const [unusedDaysInput, setUnusedDaysInput] = useState('');
  const [annualResult, setAnnualResult] = useState<{ unusedDays: number; dailyWage: number; totalPay: number } | null>(null);

  // --- 추가근무 state ---
  const [overtimeHourlyWage, setOvertimeHourlyWage] = useState('');
  const [isSmallBiz, setIsSmallBiz] = useState(false);
  const [entries, setEntries] = useState([{ type: 'extended' as string, hours: '' }]);
  const [overtimeResult, setOvertimeResult] = useState<{ details: { label: string; hours: number; rate: number; amount: number }[]; total: number } | null>(null);

  // 통상임금 결과가 나오면 다른 탭의 시간급에 자동 반영
  const applyOrdinaryToOthers = (hw: number) => {
    const hwStr = hw.toLocaleString();
    setAnnualHourlyWage(hwStr);
    setOvertimeHourlyWage(hwStr);
  };

  // --- 통상임금 계산 ---
  const calcOrdinary = () => {
    const base = parseNum(basePay);
    const fixed = parseNum(fixedAllowance);
    if (base === 0) { alert("기본급을 입력해주세요."); return; }
    const wh = Number(weeklyHours) || 40;
    const weeklyPaidHours = includeWeeklyHoliday ? wh + (wh / 5) : wh;
    const monthlyHours = Math.round((weeklyPaidHours * 365 / 7 / 12) * 100) / 100;
    const monthlyOrdinary = base + fixed;
    const hourlyWage = Math.floor(monthlyOrdinary / monthlyHours);
    const dailyWage = hourlyWage * (wh / 5);
    setOrdinaryResult({ monthlyOrdinary, weeklyPaidHours, monthlyHours, hourlyWage, dailyWage });
    applyOrdinaryToOthers(hourlyWage);
  };

  // --- 연차수당 계산 ---
  const calcAnnual = () => {
    const hw = parseNum(annualHourlyWage);
    if (hw === 0) { alert("시간급 통상임금을 입력해주세요."); return; }
    const unusedDays = parseNum(unusedDaysInput);
    if (unusedDays === 0) { alert("미사용 연차일수를 입력해주세요."); return; }
    const dh = dailyHours === 'custom' ? (Number(customDailyHours) || 0) : (Number(dailyHours) || 8);
    if (dh === 0) { alert("1일 소정근로시간을 입력해주세요."); return; }
    const dailyWage = hw * dh;
    setAnnualResult({ unusedDays, dailyWage, totalPay: unusedDays * dailyWage });
  };

  // --- 추가근무 계산 ---
  const typeLabels: Record<string, string> = { extended: '연장근로 (평일)', night: '야간근로 (22~06시)', holiday: '휴일근로 (8h이내)', holidayOver: '휴일근로 (8h초과)' };
  const getRate = (type: string) => {
    if (isSmallBiz) return type === 'night' ? 0.5 : 1;
    switch (type) { case 'extended': return 1.5; case 'night': return 0.5; case 'holiday': return 1.5; case 'holidayOver': return 2.0; default: return 1; }
  };
  const addEntry = () => setEntries([...entries, { type: 'extended', hours: '' }]);
  const removeEntry = (idx: number) => { if (entries.length > 1) setEntries(entries.filter((_, i) => i !== idx)); };
  const updateEntry = (idx: number, field: string, value: string) => { setEntries(entries.map((e, i) => i === idx ? { ...e, [field]: value } : e)); setOvertimeResult(null); };

  const calcOvertime = () => {
    const hw = parseNum(overtimeHourlyWage);
    if (hw === 0) { alert("시간급 통상임금을 입력해주세요."); return; }
    const details = entries.map(e => {
      const hours = Number(e.hours) || 0;
      const rate = getRate(e.type);
      return { label: typeLabels[e.type], hours, rate, amount: Math.floor(hw * rate * hours) };
    }).filter(d => d.hours > 0);
    setOvertimeResult({ details, total: details.reduce((sum, d) => sum + d.amount, 0) });
  };

  const subTabs = [
    { key: 'ordinary' as const, label: '통상임금' },
    { key: 'annual' as const, label: '연차수당' },
    { key: 'overtime' as const, label: '추가근무수당' },
  ];

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <BackButton onClick={onBack} />
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <CalcHeader title="통상임금 산출 및 수당 계산기" />
        {/* 서브탭 */}
        <div className="flex p-2 bg-slate-50 border-b border-slate-100">
          {subTabs.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${subTab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-8">
          {/* ===== 통상임금 탭 ===== */}
          {subTab === 'ordinary' && (
            <div className="space-y-5">
              <p className="text-[10px] text-slate-400 font-bold bg-slate-50 p-3 rounded-xl">근로기준법 시행령 제6조 | 통상임금 = 월 통상임금 / 월 소정근로시간</p>
              <MoneyInput label="월 기본급" value={basePay} onChange={(v) => { setBasePay(v); setOrdinaryResult(null); }} />
              <MoneyInput label="월 고정수당 (직무수당, 직책수당 등)" value={fixedAllowance} onChange={(v) => { setFixedAllowance(v); setOrdinaryResult(null); }} />
              <div>
                <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-1">주 소정근로시간</label>
                <div className="relative group">
                  <input type="text" value={weeklyHours} onChange={(e) => { setWeeklyHours(e.target.value.replace(/[^0-9.]/g, '')); setOrdinaryResult(null); }} placeholder="40"
                    className="w-full p-3 pr-14 bg-slate-50 border-none rounded-xl text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-400" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-300">시간</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-bold text-slate-500">주휴수당 고려</span>
                <input type="checkbox" checked={includeWeeklyHoliday} onChange={(e) => { setIncludeWeeklyHoliday(e.target.checked); setOrdinaryResult(null); }} className="w-5 h-5 accent-blue-600 cursor-pointer" />
              </div>
              <button onClick={calcOrdinary} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg transition-all active:scale-95">계산하기</button>
              {ordinaryResult && (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">월 통상임금</span><span className="text-slate-900 font-bold">{format(ordinaryResult.monthlyOrdinary)}원</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">주 유급시간</span><span className="text-slate-900 font-bold">{ordinaryResult.weeklyPaidHours}시간</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">월 소정근로시간</span><span className="text-slate-900 font-bold">{ordinaryResult.monthlyHours}시간</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-5 bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl text-center shadow-xl">
                      <p className="text-blue-100 text-[10px] mb-1 font-bold tracking-widest uppercase">시간급</p>
                      <p className="text-xl font-black text-white">{format(ordinaryResult.hourlyWage)}원</p>
                    </div>
                    <div className="p-5 bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl text-center shadow-xl">
                      <p className="text-slate-300 text-[10px] mb-1 font-bold tracking-widest uppercase">일급</p>
                      <p className="text-xl font-black text-white">{format(ordinaryResult.dailyWage)}원</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-center text-blue-500 font-bold">* 시간급이 연차수당/추가근무수당 탭에 자동 반영됩니다</p>
                </div>
              )}
            </div>
          )}

          {/* ===== 연차수당 탭 ===== */}
          {subTab === 'annual' && (
            <div className="space-y-5">
              <p className="text-[10px] text-slate-400 font-bold bg-slate-50 p-3 rounded-xl">근로기준법 제60조 | 미사용 연차일수 x 1일 통상임금</p>
              <MoneyInput label="시간급 통상임금" value={annualHourlyWage} onChange={(v) => { setAnnualHourlyWage(v); setAnnualResult(null); }} />
              <div>
                <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-2">1일 소정근로시간</label>
                <div className="grid grid-cols-4 gap-2">
                  {['8', '6', '4'].map(h => (
                    <button key={h} onClick={() => { setDailyHours(h); setAnnualResult(null); }}
                      className={`py-2.5 rounded-xl text-sm font-bold transition-all ${dailyHours === h ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{h}시간</button>
                  ))}
                  <button onClick={() => { setDailyHours('custom'); setAnnualResult(null); }}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all ${dailyHours === 'custom' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>기타</button>
                </div>
                {dailyHours === 'custom' && (
                  <div className="relative group mt-2">
                    <input type="text" value={customDailyHours} onChange={(e) => { setCustomDailyHours(e.target.value.replace(/[^0-9.]/g, '')); setAnnualResult(null); }} placeholder="0"
                      className="w-full p-3 pr-14 bg-slate-50 border-none rounded-xl text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-400" />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-300">시간</span>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 ml-1 mb-1 block">미사용 연차일수</label>
                <input type="text" value={unusedDaysInput} onChange={(e) => { setUnusedDaysInput(formatInput(e.target.value)); setAnnualResult(null); }} placeholder="0"
                  className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <button onClick={calcAnnual} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg transition-all active:scale-95">계산하기</button>
              {annualResult && (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">미사용 연차일수</span><span className="text-blue-600 font-black">{annualResult.unusedDays}일</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">1일 통상임금</span><span className="text-slate-900 font-bold">{format(annualResult.dailyWage)}원</span></div>
                  </div>
                  <div className="p-7 bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl text-center shadow-xl">
                    <p className="text-blue-100 text-xs mb-1 font-bold tracking-widest uppercase">미사용 연차수당</p>
                    <p className="text-3xl font-black text-white">{format(annualResult.totalPay)}원</p>
                    <p className="text-blue-200 text-[10px] mt-2 font-bold">{annualResult.unusedDays}일 x {format(annualResult.dailyWage)}원</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 추가근무수당 탭 ===== */}
          {subTab === 'overtime' && (
            <div className="space-y-5">
              <p className="text-[10px] text-slate-400 font-bold bg-slate-50 p-3 rounded-xl">근로기준법 제56조 | 연장(x1.5) / 야간(x0.5 가산) / 휴일(x1.5~2.0)</p>
              <MoneyInput label="시간급 통상임금" value={overtimeHourlyWage} onChange={(v) => { setOvertimeHourlyWage(v); setOvertimeResult(null); }} />
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-bold text-slate-500">5인 미만 사업장 (가산율 미적용)</span>
                <input type="checkbox" checked={isSmallBiz} onChange={(e) => { setIsSmallBiz(e.target.checked); setOvertimeResult(null); }} className="w-5 h-5 accent-blue-600 cursor-pointer" />
              </div>
              <div className="space-y-3">
                <label className="block text-[11px] font-bold text-slate-400 ml-1">근무 내역</label>
                {entries.map((entry, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select value={entry.type} onChange={(e) => updateEntry(idx, 'type', e.target.value)}
                      className="flex-1 p-3 bg-slate-50 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="extended">연장근로 (평일)</option>
                      <option value="night">야간근로 (22~06시)</option>
                      <option value="holiday">휴일근로 (8h이내)</option>
                      <option value="holidayOver">휴일근로 (8h초과)</option>
                    </select>
                    <input type="number" value={entry.hours} onChange={(e) => updateEntry(idx, 'hours', e.target.value)} placeholder="시간"
                      className="w-20 p-3 bg-slate-50 border-none rounded-xl text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-400" />
                    <span className="text-xs text-slate-400 font-bold">h</span>
                    {entries.length > 1 && (
                      <button onClick={() => removeEntry(idx)} className="text-slate-300 hover:text-rose-400 font-bold text-lg transition-colors">x</button>
                    )}
                  </div>
                ))}
                <button onClick={addEntry} className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm font-bold text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-all">+ 근무 내역 추가</button>
              </div>
              <button onClick={calcOvertime} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg transition-all active:scale-95">계산하기</button>
              {overtimeResult && overtimeResult.details.length > 0 && (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="border rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-400 font-bold text-[10px] uppercase">
                        <tr><th className="p-3 text-left">구분</th><th className="p-3 text-right">시간</th><th className="p-3 text-right">배율</th><th className="p-3 text-right">금액</th></tr>
                      </thead>
                      <tbody className="font-bold text-slate-700">
                        {overtimeResult.details.map((d, i) => (
                          <tr key={i} className="border-t border-slate-50">
                            <td className="p-3 text-xs">{d.label}</td>
                            <td className="p-3 text-right">{d.hours}h</td>
                            <td className="p-3 text-right text-slate-400">x{d.rate}</td>
                            <td className="p-3 text-right text-blue-600">{format(d.amount)}원</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-7 bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl text-center shadow-xl">
                    <p className="text-blue-100 text-xs mb-1 font-bold tracking-widest uppercase">추가근무수당 합계</p>
                    <p className="text-3xl font-black text-white">{format(overtimeResult.total)}원</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================
// 메인 페이지
// =============================================
type TabKey = 'home' | 'regularSalary' | 'salary' | 'freelancer' | 'wageAllowance' | 'dbUpload' | 'businessInfoUpload' | 'businessLookup' | 'bizStatusBulk' | 'accountRecommend' | 'cashReceiptClassifier';
type CategoryKey = 'home' | 'labor' | 'tax';
type MenuGroup = { category: CategoryKey; label: string; color: string; items: { key: TabKey; icon: string; title: string; desc: string }[] };

const menuGroups: MenuGroup[] = [
  {
    category: 'labor',
    label: '노무 관리',
    color: '#2563EB',
    items: [
      { key: 'regularSalary', icon: '\uD83D\uDCBC', title: '2026년 연봉 계산기', desc: '4대보험/소득세 정밀 계산 및 역산' },
      { key: 'salary', icon: '\uD83D\uDCCA', title: '급여 일할 계산기', desc: '입/퇴사자 급여 일수별 계산' },
      { key: 'freelancer', icon: '\u2702\uFE0F', title: '프리랜서 3.3% 계산기', desc: '개별/대량 역산 및 세금 계산' },
      { key: 'wageAllowance', icon: '\u23F0', title: '통상임금 산출 및 수당 계산기', desc: '통상임금 / 연차수당 / 추가근무수당' },
    ],
  },
  {
    category: 'tax',
    label: '세무 관리',
    color: '#7C3AED',
    items: [
      { key: 'dbUpload', icon: '\uD83D\uDDC4\uFE0F', title: '분류DB 관리', desc: '신용카드·현금영수증 정답지 업로드' },
      { key: 'businessInfoUpload', icon: '\uD83C\uDFE2', title: '사업자DB 관리', desc: '국세청 카드내역으로 사업자 정보 구축' },
      { key: 'businessLookup', icon: '\uD83D\uDD0D', title: '사업자 조회', desc: '사업자등록번호 조회 및 업종 분류' },
      { key: 'bizStatusBulk', icon: '\uD83C\uDFE2', title: '사업자상태조회', desc: '폐업·휴업·과세유형 일괄 조회' },
      { key: 'accountRecommend', icon: '\uD83D\uDCCB', title: '카드전표 계정과목 분류', desc: '카드매입 엑셀 자동 분류 및 SmartA10 변환' },
      { key: 'cashReceiptClassifier', icon: '\uD83E\uDDFE', title: '현금영수증 계정과목 분류', desc: '현금영수증 매입 엑셀 업종 조회 및 자동 분류' },
    ],
  },
];

function SideNav({ activeTab, onTabChange }: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
}) {
  const group = menuGroups.find(g => g.items.some(i => i.key === activeTab));
  if (!group) return null;

  return (
    <div className="hidden lg:block self-start shrink-0 w-52">
      {/* 돌아가기 버튼 높이만큼 spacer - 카드 상단에 맞춤 */}
      <div className="h-9" />
      <nav className="sticky top-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-[11px] font-black text-slate-400 tracking-wider uppercase mb-3">{group.label}</h3>
        <ul className="space-y-1">
          {group.items.map(item => {
            const isActive = item.key === activeTab;
            return (
              <li key={item.key}>
                <button onClick={() => onTabChange(item.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all leading-snug ${
                    isActive
                      ? 'text-white'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                  style={isActive ? { background: group.color } : undefined}>
                  {item.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export default function MainPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('home');
  const goHome = () => { setActiveTab('home'); setActiveCategory('home'); };

  const currentGroup = menuGroups.find(g => g.category === activeCategory);

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 ${activeTab === 'home' ? 'flex items-center justify-center p-6' : ''}`}>
      {activeTab === 'home' && (
        <div className="w-full max-w-md animate-in fade-in zoom-in duration-500 text-center">
          <div className="bg-blue-600 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-200">
            <span className="text-white text-3xl font-black">C</span>
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">커넥트 세무회계</h1>
          <p className="text-slate-500 font-bold mt-1 mb-10">김성엽 대리 업무 전용 툴박스</p>

          {activeCategory === 'home' ? (
            // 상위 탭 선택 화면
            <div className="grid grid-cols-2 gap-4">
              {menuGroups.map(group => (
                <button key={group.category} onClick={() => setActiveCategory(group.category)}
                  className="group bg-white p-8 rounded-3xl shadow-md border border-slate-100 hover:shadow-xl transition-all text-center flex flex-col items-center gap-3"
                  style={{ borderTop: `4px solid ${group.color}` }}>
                  <span className="text-3xl font-black" style={{ color: group.color }}>
                    {group.label === '노무' ? '\uD83D\uDC64' : '\uD83D\uDCDD'}
                  </span>
                  <div>
                    <h3 className="font-black text-slate-800 text-xl">{group.label}</h3>
                    <p className="text-slate-400 text-[11px] font-bold mt-1">{group.items.length}개 메뉴</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            // 하위 메뉴 화면
            <div className="space-y-3">
              <div className="flex items-center gap-3 mb-6">
                <button onClick={() => setActiveCategory('home')}
                  className="text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors">
                  &#8592; 전체
                </button>
                <span className="font-black text-slate-700 text-lg"
                  style={{ color: currentGroup?.color }}>
                  {currentGroup?.label}
                </span>
              </div>
              {currentGroup?.items.map(item => (
                <button key={item.key} onClick={() => setActiveTab(item.key)}
                  className="group bg-white p-5 rounded-2xl shadow-md border border-slate-100 hover:shadow-xl transition-all text-left flex items-center gap-4 w-full"
                  style={{ ['--hover-color' as string]: currentGroup.color }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 transition-colors"
                    style={{ background: `${currentGroup.color}15` }}>
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800">{item.title}</h3>
                    <p className="text-slate-400 text-[11px] font-bold mt-0.5">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <p className="text-slate-300 text-[10px] mt-12 font-bold tracking-widest uppercase">&copy; 2026 CONNECT TAX SERVICES</p>
        </div>
      )}

      {activeTab !== 'home' && (
        <div className="w-full min-h-screen flex flex-col justify-center py-10">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(28rem, max-content) 1fr', columnGap: '1.5rem', padding: '0 1.5rem' }}>
            {/* 왼쪽 빈 칸 — 사이드바 폭만큼 균형 */}
            <div />
            {/* 중앙 카드 */}
            <div>
              {activeTab === 'regularSalary' && <RegularSalaryCalc onBack={goHome} />}
              {activeTab === 'salary' && <SalaryCalc onBack={goHome} />}
              {activeTab === 'freelancer' && <FreelancerCalc onBack={goHome} />}
              {activeTab === 'wageAllowance' && <WageAndAllowanceCalc onBack={goHome} />}
              {activeTab === 'dbUpload' && <DbUpload onBack={goHome} />}
              {activeTab === 'businessInfoUpload' && <BusinessInfoUpload onBack={goHome} />}
              {activeTab === 'businessLookup' && <BusinessLookup onBack={goHome} />}
              {activeTab === 'accountRecommend' && <AccountRecommend onBack={goHome} />}
              {activeTab === 'cashReceiptClassifier' && <CashReceiptClassifier onBack={goHome} />}
              {activeTab === 'bizStatusBulk' && <BizStatusBulkChecker onBack={goHome} />}
            </div>
            {/* 우측 사이드바 */}
            <div>
              <SideNav activeTab={activeTab} onTabChange={setActiveTab} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
