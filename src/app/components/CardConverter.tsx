"use client";
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';

interface CardRow {
  거래일자: string;
  '거래처(가맹점명)': string;
  품명: string;
  합계: string;
  공제여부: string;
  거래구분: string;
  대변계정코드: string;
}

interface GroupedCard {
  last4: string;
  rows: CardRow[];
}

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

// 날짜를 YYYYMMDD 형식으로 정규화
function normalizeDate(raw: string | number): string {
  if (typeof raw === 'number') {
    // Excel 시리얼 날짜 변환
    const date = new Date(Math.round((raw - 25569) * 86400 * 1000));
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  return String(raw).replace(/[-./\s]/g, '').slice(0, 8);
}

// 카드번호에서 마지막 4자리 추출
function extractLast4(raw: string | number): string {
  const str = String(raw).replace(/\D/g, '');
  return str.slice(-4) || '0000';
}

// 숫자 정규화 (쉼표 제거)
function normalizeAmount(raw: string | number): string {
  return String(raw).replace(/,/g, '').replace(/[^0-9.-]/g, '');
}

export default function CardConverter({ onBack }: { onBack: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<GroupedCard[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>('');

  const processFile = async (file: File) => {
    setError('');
    setGroups([]);
    setFileName(file.name);
    setLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: '' });

      if (rawRows.length === 0) {
        setError('엑셀 파일에 데이터가 없습니다.');
        setLoading(false);
        return;
      }

      const columns = Object.keys(rawRows[0]);

      // Claude API로 컬럼 매핑
      const res = await fetch('/api/convert/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, sampleRows: rawRows.slice(0, 3) }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'API 오류');
      }

      const mapping: { dateCol: string; merchantCol: string; amountCol: string; cardCol: string } = await res.json();

      // 데이터 변환 + 카드번호별 그룹화
      const grouped: Record<string, CardRow[]> = {};

      for (const row of rawRows) {
        const last4 = mapping.cardCol ? extractLast4(row[mapping.cardCol] as string) : '0000';
        const cardRow: CardRow = {
          거래일자: mapping.dateCol ? normalizeDate(row[mapping.dateCol] as string | number) : '',
          '거래처(가맹점명)': mapping.merchantCol ? String(row[mapping.merchantCol]) : '',
          품명: mapping.merchantCol ? String(row[mapping.merchantCol]) : '',
          합계: mapping.amountCol ? normalizeAmount(row[mapping.amountCol] as string | number) : '',
          공제여부: '불공제',
          거래구분: '승인',
          대변계정코드: '253',
        };
        if (!grouped[last4]) grouped[last4] = [];
        grouped[last4].push(cardRow);
      }

      const groupList: GroupedCard[] = Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([last4, rows]) => ({ last4, rows }));

      setGroups(groupList);
      setActiveGroup(groupList[0]?.last4 ?? '');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(xls|xlsx|csv)$/i)) {
      setError('엑셀 파일(.xls, .xlsx, .csv)만 지원합니다.');
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

  const updateCell = (groupLast4: string, rowIdx: number, field: keyof CardRow, value: string) => {
    setGroups(prev => prev.map(g => {
      if (g.last4 !== groupLast4) return g;
      const rows = g.rows.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r);
      return { ...g, rows };
    }));
  };

  const downloadGroup = (group: GroupedCard) => {
    const wsData = [
      ['거래일자', '거래처(가맹점명)', '품명', '합계', '공제여부', '거래구분', '대변계정코드'],
      ...group.rows.map(r => [
        r.거래일자, r['거래처(가맹점명)'], r.품명, r.합계,
        r.공제여부, r.거래구분, r.대변계정코드,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '신용카드 매입');
    XLSX.writeFile(wb, `${group.last4}.xls`);
  };

  const downloadAll = () => {
    groups.forEach(g => downloadGroup(g));
  };

  const currentGroup = groups.find(g => g.last4 === activeGroup);

  return (
    <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <BackButton onClick={onBack} />
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        <CalcHeader title="카드내역 업로드 변환기" />
        <div className="p-8 space-y-6">

          {/* 파일 업로드 영역 */}
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
              accept=".xls,.xlsx,.csv"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
            />
            <div className="text-3xl mb-2">📂</div>
            <p className="font-bold text-slate-600">카드사 엑셀 파일을 드래그하거나 클릭해서 업로드</p>
            <p className="text-xs text-slate-400 font-bold mt-1">.xls · .xlsx · .csv 지원</p>
            {fileName && <p className="mt-3 text-sm font-bold text-blue-600">{fileName}</p>}
          </div>

          {/* 로딩 */}
          {loading && (
            <div className="text-center py-6">
              <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm font-bold text-slate-500">AI가 컬럼을 분석 중입니다...</p>
            </div>
          )}

          {/* 오류 */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-600 text-sm font-bold">
              {error}
            </div>
          )}

          {/* 결과 */}
          {groups.length > 0 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
              {/* 카드 탭 + 전체 다운로드 */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex gap-2 flex-wrap">
                  {groups.map(g => (
                    <button
                      key={g.last4}
                      onClick={() => setActiveGroup(g.last4)}
                      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        activeGroup === g.last4
                          ? 'bg-blue-600 text-white shadow'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      카드 {g.last4} ({g.rows.length}건)
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {currentGroup && (
                    <button
                      onClick={() => downloadGroup(currentGroup)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-sm font-bold transition-colors"
                    >
                      {currentGroup.last4}.xls 다운로드
                    </button>
                  )}
                  <button
                    onClick={downloadAll}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors"
                  >
                    전체 다운로드 ({groups.length}개)
                  </button>
                </div>
              </div>

              {/* 미리보기 테이블 */}
              {currentGroup && (
                <div className="overflow-x-auto border rounded-2xl">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-400 font-bold text-[11px] uppercase">
                      <tr>
                        {['거래일자', '거래처(가맹점명)', '품명', '합계', '공제여부', '거래구분', '대변계정코드'].map(h => (
                          <th key={h} className="px-3 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-bold text-slate-700">
                      {currentGroup.rows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          {(Object.keys(row) as (keyof CardRow)[]).map(field => (
                            <td key={field} className="px-2 py-1">
                              <input
                                type="text"
                                value={row[field]}
                                onChange={(e) => updateCell(currentGroup.last4, i, field, e.target.value)}
                                className="w-full px-2 py-1 rounded-lg bg-transparent hover:bg-blue-50 focus:bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400 text-sm font-bold min-w-[80px]"
                              />
                            </td>
                          ))}
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
