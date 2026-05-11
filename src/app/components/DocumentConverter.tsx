"use client";
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import type { JournalEntry } from '@/app/api/convert/document/route';
import AccountAutocomplete from './AccountAutocomplete';

const JOURNAL_HEADERS = ['월', '일', '구분', '계정과목코드', '계정과목명', '거래처코드', '거래처명', '적요명', '차변', '대변'];
const ENTRY_FIELDS: (keyof JournalEntry)[] = ['month', 'day', 'type', 'accountCode', 'accountName', 'partnerCode', 'partnerName', 'memo', 'debit', 'credit'];
const ACCEPTED_EXT = /\.(jpg|jpeg|png|webp|gif|pdf)$/i;

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors">
      &#8592; 돌아가기
    </button>
  );
}

function CalcHeader({ title }: { title: string }) {
  return (
    <div className="bg-violet-600 p-8 text-center text-white">
      <h1 className="text-2xl font-black mb-1">{title}</h1>
      <p className="text-violet-100 text-xs font-bold uppercase tracking-widest opacity-80">Connect Tax Services</p>
    </div>
  );
}

type CostType = '제조' | '도급' | '판관비';
const COST_TYPES: CostType[] = ['제조', '도급', '판관비'];

export default function DocumentConverter({ onBack }: { onBack: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [costType, setCostType] = useState<CostType>('판관비');

  const handleCostTypeChange = (type: CostType) => {
    setCostType(type);
    setEntries([]);
    setFileNames([]);
    setError('');
  };

  const processOneFile = async (file: File): Promise<JournalEntry[]> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('costType', costType);

    const res = await fetch('/api/convert/document', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      const debugStr = err.debug ? ` [${err.debug.fileName}, ${err.debug.fileType}, ${err.debug.fileSize}bytes]` : '';
      throw new Error((err.error ?? 'API 오류') + debugStr);
    }

    const data = await res.json();
    return data.entries ?? [];
  };

  const processFiles = async (files: File[]) => {
    setError('');
    setEntries([]);
    setFileNames(files.map(f => f.name));
    setLoading(true);

    const allEntries: JournalEntry[] = [];
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress({ current: i + 1, total: files.length, name: file.name });
      try {
        const fetched = await processOneFile(file);
        if (fetched.length === 0) {
          failures.push(`${file.name}: 추출 데이터 없음`);
        } else {
          allEntries.push(...fetched);
          setEntries([...allEntries]);
        }
      } catch (e: unknown) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : '처리 실패'}`);
      }
    }

    setProgress(null);
    setLoading(false);
    if (failures.length > 0) {
      setError(failures.join(' / '));
    }
  };

  const handleFiles = (files: File[]) => {
    const valid = files.filter(f => ACCEPTED_EXT.test(f.name));
    const invalidCount = files.length - valid.length;
    if (valid.length === 0) {
      setError('JPG, PNG, WEBP, GIF, PDF 파일만 지원합니다.');
      return;
    }
    if (invalidCount > 0) {
      setError(`지원하지 않는 파일 ${invalidCount}개는 건너뜁니다.`);
    }
    processFiles(valid);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  };

  const updateCell = (rowIdx: number, field: keyof JournalEntry, value: string) => {
    setEntries(prev => prev.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r));
  };

  // 계정과목 코드/이름 페어 동기화: 한쪽 선택 시 두 칸 동시 업데이트
  const updateAccountPair = (rowIdx: number, code: string, name: string) => {
    setEntries(prev => prev.map((r, i) => i === rowIdx ? { ...r, accountCode: code, accountName: name } : r));
  };

  const formatAmount = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    return digits === '' ? '' : Number(digits).toLocaleString('ko-KR');
  };

  const handleAmountChange = (rowIdx: number, field: 'debit' | 'credit', value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    updateCell(rowIdx, field, digits);
  };

  const addRow = () => {
    setEntries(prev => [...prev, {
      month: '', day: '', type: '출금',
      accountCode: '', accountName: '',
      partnerCode: '', partnerName: '',
      memo: '', debit: '', credit: '',
    }]);
  };

  const removeRow = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const download = () => {
    const wsData = [
      JOURNAL_HEADERS,
      ...entries.map(e => ENTRY_FIELDS.map(f => e[f])),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, '일반전표올리기.xlsx');
  };

  return (
    <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <BackButton onClick={onBack} />
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <CalcHeader title="문서 → 일반전표 변환기" />
        <div className="p-8 space-y-6">

          {/* 비용 구분 선택 */}
          <div>
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">비용 구분</p>
            <div className="flex gap-2">
              {COST_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => handleCostTypeChange(type)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    costType === type
                      ? 'bg-violet-600 text-white shadow'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* 파일 업로드 */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              isDragging ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-violet-400 hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.gif,.pdf"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length > 0) handleFiles(files);
                e.target.value = '';
              }}
            />
            <div className="text-3xl mb-2">📄</div>
            <p className="font-bold text-slate-600">파일을 드래그하거나 클릭해서 업로드 (여러 개 가능)</p>
            <p className="text-xs text-slate-400 font-bold mt-1">PDF · JPG · PNG · WEBP 지원 — 문서 유형은 AI가 자동 판단</p>
            {fileNames.length > 0 && (
              <p className="mt-3 text-sm font-bold text-violet-600">
                {fileNames.length === 1 ? fileNames[0] : `${fileNames.length}개 파일 선택됨`}
              </p>
            )}
          </div>

          {/* 로딩 */}
          {loading && (
            <div className="text-center py-6">
              <div className="inline-block w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm font-bold text-slate-500">
                {progress
                  ? `AI 분석 중... (${progress.current}/${progress.total}) ${progress.name}`
                  : 'AI가 문서를 분석 중입니다...'}
              </p>
            </div>
          )}

          {/* 오류 */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-600 text-sm font-bold">
              {error}
            </div>
          )}

          {/* 결과 */}
          {entries.length > 0 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-600">{entries.length}행 추출됨</span>
                <div className="flex gap-2">
                  <button
                    onClick={addRow}
                    className="px-4 py-2 border-2 border-dashed border-slate-300 hover:border-violet-400 text-slate-500 hover:text-violet-600 rounded-xl text-sm font-bold transition-colors"
                  >
                    + 행 추가
                  </button>
                  <button
                    onClick={download}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-colors"
                  >
                    일반전표올리기.xlsx 다운로드
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border rounded-2xl">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-400 font-bold text-[11px] uppercase">
                    <tr>
                      {JOURNAL_HEADERS.map(h => (
                        <th key={h} className="px-3 py-3 whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody className="font-bold text-slate-700">
                    {entries.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        {ENTRY_FIELDS.map(field => (
                          <td key={field} className="px-2 py-1">
                            {field === 'type' ? (
                              <select
                                value={row[field]}
                                onChange={(e) => updateCell(i, field, e.target.value)}
                                className="px-2 py-1 rounded-lg bg-transparent hover:bg-violet-50 focus:bg-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400 text-sm font-bold"
                              >
                                <option value="출금">출금</option>
                                <option value="입금">입금</option>
                                <option value="차변">차변</option>
                                <option value="대변">대변</option>
                              </select>
                            ) : (field === 'debit' || field === 'credit') ? (
                              <input
                                type="text"
                                value={formatAmount(row[field])}
                                onChange={(e) => handleAmountChange(i, field, e.target.value)}
                                className="w-full px-2 py-1 rounded-lg bg-transparent hover:bg-violet-50 focus:bg-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400 text-sm font-bold text-right"
                                style={{ minWidth: '80px' }}
                              />
                            ) : field === 'accountCode' ? (
                              <div style={{ minWidth: '90px' }}>
                                <AccountAutocomplete
                                  value={row.accountCode}
                                  onChange={(v) => updateCell(i, 'accountCode', v)}
                                  onSelect={(code, name) => updateAccountPair(i, code, name)}
                                  placeholder="코드"
                                  className="w-full px-2 py-1 rounded-lg bg-transparent hover:bg-violet-50 focus:bg-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400 text-sm font-bold tabular-nums"
                                />
                              </div>
                            ) : field === 'accountName' ? (
                              <div style={{ minWidth: '140px' }}>
                                <AccountAutocomplete
                                  value={row.accountName}
                                  onChange={(v) => updateCell(i, 'accountName', v)}
                                  onSelect={(code, name) => updateAccountPair(i, code, name)}
                                  placeholder="계정과목명"
                                  className="w-full px-2 py-1 rounded-lg bg-transparent hover:bg-violet-50 focus:bg-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400 text-sm font-bold"
                                />
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={row[field]}
                                onChange={(e) => updateCell(i, field, e.target.value)}
                                className="w-full px-2 py-1 rounded-lg bg-transparent hover:bg-violet-50 focus:bg-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400 text-sm font-bold"
                                style={{ minWidth: field === 'memo' ? '100px' : '50px' }}
                              />
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-1">
                          <button
                            onClick={() => removeRow(i)}
                            className="text-slate-300 hover:text-rose-400 font-bold text-lg transition-colors"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
