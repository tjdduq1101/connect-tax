"use client";
import { useState, useCallback } from 'react';

interface Props {
  onBack: () => void;
}

export default function VatNotice({ onBack }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);

  function handleFileSelect(f: File | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setErrorMsg('PDF 파일만 업로드 가능합니다.');
      return;
    }
    setFile(f);
    setStatus('idle');
    setErrorMsg('');
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files[0] ?? null);
  }, []);

  async function handleDownload() {
    if (!file) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const res = await fetch('/api/vat-notice', { method: 'POST', body: formData });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        throw new Error(json.error ?? '서버 오류');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '부가가치세_신고안내문.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
      setStatus('error');
    }
  }

  return (
    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={onBack} className="mb-4 text-slate-400 hover:text-blue-600 text-sm font-bold flex items-center gap-1 transition-colors">
        &#8592; 돌아가기
      </button>
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-emerald-600 p-8 text-center text-white">
        <h1 className="text-2xl font-black mb-1">부가세 신고안내문 자동입력</h1>
        <p className="text-emerald-100 text-xs font-bold uppercase tracking-widest opacity-80">
          Connect Tax Services
        </p>
      </div>

      <div className="p-8 space-y-5">
        {/* 드래그 업로드 영역 */}
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-emerald-500 bg-emerald-50'
              : file
              ? 'border-emerald-400 bg-emerald-50'
              : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
          }`}
        >
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => handleFileSelect(e.target.files?.[0] ?? null)}
          />
          <div className="text-3xl mb-2">{file ? '📄' : '⬆️'}</div>
          {file ? (
            <div>
              <p className="text-sm font-black text-emerald-700 truncate">{file.name}</p>
              <p className="text-xs text-slate-400 mt-1">다른 파일을 선택하려면 클릭하세요</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-bold text-slate-600">PDF를 끌어다 놓거나 클릭하여 선택</p>
              <p className="text-xs text-slate-400 mt-1">홈택스 부가가치세 신고서 PDF</p>
            </div>
          )}
        </label>

        {/* 설명 */}
        <div className="bg-slate-50 rounded-2xl p-4 space-y-1.5 text-xs text-slate-500 font-bold">
          <p>✅ 매출: 전자세금계산서 / 카드·현금영수증 / 기타</p>
          <p>✅ 매입: 전자세금계산서(불공제 차감) / 카드·현금영수증 / 고정자산</p>
          <p>✅ 예정고지세액 · 가산세 등 자동 반영</p>
          <p className="text-slate-400">엑셀 서식(디자인)은 변경되지 않습니다.</p>
        </div>

        {/* 다운로드 버튼 */}
        <button
          onClick={handleDownload}
          disabled={!file || status === 'loading'}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black rounded-2xl text-lg shadow-lg active:scale-95 transition-all"
        >
          {status === 'loading' ? '처리 중...' : '📥 엑셀 다운로드'}
        </button>

        {/* 상태 메시지 */}
        {status === 'done' && (
          <p className="text-center text-sm font-bold text-emerald-600">✅ 다운로드 완료!</p>
        )}
        {status === 'error' && (
          <p className="text-center text-sm font-bold text-red-500">{errorMsg}</p>
        )}
        {status === 'idle' && errorMsg && (
          <p className="text-center text-sm font-bold text-red-500">{errorMsg}</p>
        )}
      </div>
      </div>
    </div>
  );
}
