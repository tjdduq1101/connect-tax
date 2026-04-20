declare global {
  interface Window {
    html2canvas?: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  }
}

async function loadHtml2Canvas(): Promise<void> {
  if (window.html2canvas) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-html2canvas]');
    if (existing) {
      // 태그는 있지만 아직 로딩 중인 경우 완료 이벤트 대기
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('html2canvas 로드 실패')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.dataset.html2canvas = '1';
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('html2canvas 로드 실패'));
    document.head.appendChild(s);
  });
}

// 캔버스에 둥근 모서리 클리핑 적용 (rounded-3xl = 24px, scale 2 = 48px)
function applyRoundedCorners(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const dst = document.createElement('canvas');
  dst.width = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d')!;
  const w = src.width, h = src.height, r = radius;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  return dst;
}

export async function downloadAsImage(el: HTMLElement, filename: string): Promise<void> {
  try {
    await loadHtml2Canvas();
  } catch {
    alert('이미지 저장에 실패했습니다. 인터넷 연결을 확인해주세요.');
    return;
  }
  if (!window.html2canvas) {
    alert('이미지 저장에 실패했습니다.');
    return;
  }
  const raw = await window.html2canvas(el, { backgroundColor: null, scale: 2, useCORS: true });
  const canvas = applyRoundedCorners(raw, 48);
  canvas.toBlob((blob: Blob | null) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export function printResult(el: HTMLElement): void {
  el.classList.add('print-target');
  document.body.classList.add('printing');
  window.print();
  window.addEventListener('afterprint', () => {
    el.classList.remove('print-target');
    document.body.classList.remove('printing');
  }, { once: true });
}
