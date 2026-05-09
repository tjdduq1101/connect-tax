"use client";
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import type { JournalEntry } from '@/app/api/convert/document/route';

type DocType = 'loan' | 'telecom' | 'other';

interface DocTypeOption {
  value: DocType;
  label: string;
  icon: string;
}

const DOC_TYPES: DocTypeOption[] = [
  { value: 'loan', label: '원리금상환내역서', icon: '🏦' },
  { value: 'telecom', label: '통신비납부내역서', icon: '📱' },
  { value: 'other', label: '기타 경비', icon: '📋' },
];

const JOURNAL_HEADERS = ['월', '일', '구분', '계정과목코드', '계정과목명', '거래처코드', '거래처명', '적요명', '차변', '대변'];
const ENTRY_FIELDS: (keyof JournalEntry)[] = ['month', 'day', 'type', 'accountCode', 'accountName', 'partnerCode', 'partnerName', 'memo', 'debit', 'credit'];

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

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const ACCEPTED_EXT = /\.(jpg|jpeg|png|webp|gif|pdf)$/i;

export default function DocumentConverter({ onBack }: { onBack: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [docType, setDocType] = useState<DocType>('loan');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  const processFile = async (file: File) => {
    setError('');
    setEntries([]);
    setFileName(file.name);
    setLoading(true);

    try {
      let fileBase64 = '';
      let mimeType = file.type;

      if (file.name.toLowerCase().endsWith('.pdf')) {
        // PDF는 이미지로 처리할 수 없으므로 안내
        setError('PDF 파일은 현재 지원하지 않습니다. 이미지(JPG, PNG)로 변환 후 업로드해주세요.');
        setLoading(false);
        return;
      }

      if (!ACCEPTED_TYPES.includes(mimeType)) {
        mimeType = 'image/jpeg';
      }

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      fileBase64 = btoa(binary);

      const res = await fetch('/api/convert/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, mimeType, docType }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'API 오류');
      }

      const data = await res.json();
      setEntries(data.entries ?? []);

      if ((data.entries ?? []).length === 0) {
        setError('문서에서 데이터를 추출하지 못했습니다. 이미지 품질을 확인해주세요.');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (file: File) => {
    if (!ACCEPTED_EXT.test(file.name)) {
      setError('이미지 파일(JPG, PNG, WEBP, GIF)만 지원합니다.');
      return;
    }
    processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const updateCell = (rowIdx: number, field: keyof JournalEntry, value: string) => {
    setEntries(prev => prev.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r));
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

          {/* 문서 유형 선택 */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 ml-1 mb-2">문서 유형</label>
            <div className="grid grid-cols-3 gap-3">
              {DOC_TYPES.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setDocType(opt.value); setEntries([]); setError(''); }}
                  className={`py-3 px-4 rounded-xl border-2 text-sm font-bold transition-all flex items-center gap-2 justify-center ${
                    docType === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-slate-100 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
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
              isDragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
            />
            <div className="text-3xl mb-2">🖼️</div>
            <p className="font-bold text-slate-600">이미지 파일을 드래그하거나 클릭해서 업로드</p>
            <p className="text-xs text-slate-400 font-bold mt-1">JPG · PNG · WEBP · GIF 지원 (PDF는 이미지로 변환 후 업로드)</p>
            {fileName && <p className="mt-3 text-sm font-bold text-blue-600">{fileName}</p>}
          </div>

          {/* 로딩 */}
          {loading && (
            <div className="text-center py-6">
              <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm font-bold text-slate-500">AI가 문서를 분석 중입니다...</p>
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
                    className="px-4 py-2 border-2 border-dashed border-slate-300 hover:border-blue-400 text-slate-500 hover:text-blue-600 rounded-xl text-sm font-bold transition-colors"
                  >
                    + 행 추가
                  </button>
                  <button
                    onClick={download}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors"
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
                                className="px-2 py-1 rounded-lg bg-transparent hover:bg-blue-50 focus:bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400 text-sm font-bold"
                              >
                                <option value="출금">출금</option>
                                <option value="입금">입금</option>
                                <option value="차변">차변</option>
                                <option value="대변">대변</option>
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={row[field]}
                                onChange={(e) => updateCell(i, field, e.target.value)}
                                className="w-full px-2 py-1 rounded-lg bg-transparent hover:bg-blue-50 focus:bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400 text-sm font-bold"
                                style={{ minWidth: field === 'memo' || field === 'accountName' ? '100px' : '50px' }}
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
