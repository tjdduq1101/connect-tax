export function printResult(el: HTMLElement): void {
  el.classList.add('print-target');
  document.body.classList.add('printing');
  window.print();
  window.addEventListener('afterprint', () => {
    el.classList.remove('print-target');
    document.body.classList.remove('printing');
  }, { once: true });
}
