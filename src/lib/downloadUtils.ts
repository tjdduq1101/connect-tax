declare global {
  interface Window {
    html2canvas?: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  }
}

const SCRIPT_SOURCES = [
  '/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

async function loadHtml2Canvas(): Promise<void> {
  if (window.html2canvas) return;
  let lastError: unknown = null;
  for (const src of SCRIPT_SOURCES) {
    try {
      await loadScript(src);
      if (window.html2canvas) return;
    } catch (err) {
      lastError = err;
      console.warn('[downloadAsImage] 스크립트 로드 실패:', src, err);
    }
  }
  throw new Error(`html2canvas 로드 실패: ${String(lastError)}`);
}

function applyRoundedCorners(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const dst = document.createElement('canvas');
  dst.width = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d')!;
  const w = src.width, h = src.height, r = Math.min(radius, w / 2, h / 2);
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

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadAsImage(el: HTMLElement, filename: string): Promise<void> {
  try {
    await loadHtml2Canvas();
  } catch (err) {
    console.error('[downloadAsImage] html2canvas 로드 실패', err);
    alert('이미지 저장 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 광고 차단기 설정을 확인해주세요.');
    return;
  }
  if (!window.html2canvas) {
    alert('이미지 저장에 실패했습니다.');
    return;
  }
  try {
    const raw = await window.html2canvas(el, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const rounded = applyRoundedCorners(raw, 48);
    await new Promise<void>((resolve) => {
      rounded.toBlob((blob) => {
        if (!blob) {
          alert('이미지 생성에 실패했습니다.');
          resolve();
          return;
        }
        triggerDownload(blob, `${filename}.png`);
        resolve();
      }, 'image/png');
    });
  } catch (err) {
    console.error('[downloadAsImage] 캡처 실패', err);
    alert('이미지 캡처 중 오류가 발생했습니다.');
  }
}

export function printResult(el: HTMLElement): void {
  el.classList.add('print-target');
  document.body.classList.add('printing');
  const cleanup = () => {
    el.classList.remove('print-target');
    document.body.classList.remove('printing');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
