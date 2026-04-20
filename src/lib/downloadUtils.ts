declare global {
  interface Window {
    html2canvas?: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  }
}

async function getCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  if (typeof window !== 'undefined' && window.html2canvas) {
    return window.html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
  }
  await new Promise<void>((resolve, reject) => {
    if (document.querySelector('script[data-html2canvas]')) { resolve(); return; }
    const s = document.createElement('script');
    s.dataset.html2canvas = '1';
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('html2canvas 로드 실패'));
    document.head.appendChild(s);
  });
  if (!window.html2canvas) throw new Error('html2canvas를 불러오지 못했습니다');
  return window.html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
}

export async function downloadAsImage(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await getCanvas(el);
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
