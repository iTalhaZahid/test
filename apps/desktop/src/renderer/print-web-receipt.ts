export function printWebReceipt() {
  const receipt = document.querySelector<HTMLElement>('.receipt-dialog .thermal-receipt');
  if (!receipt) throw new Error('Receipt is not ready to print.');
  // Automatic receipts are hidden on screen; measure a copy at the printed width.
  const copy = receipt.cloneNode(true) as HTMLElement;
  copy.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;width:72mm;margin:0';
  document.body.append(copy);
  let height: number;
  try { height = copy.getBoundingClientRect().height; }
  finally { copy.remove(); }
  if (!Number.isFinite(height) || height <= 0) throw new Error('Receipt layout is not ready. Retry printing.');
  const page = document.createElement('style');
  page.media = 'print';
  // CSS pixels are 1/96 inch. Include the existing 4mm margins on both ends.
  page.textContent = `@page { size: 80mm ${Math.ceil(height * 25.4 / 96) + 8}mm; margin: 4mm; }`;
  document.head.append(page);
  try { window.print(); }
  finally { page.remove(); }
}
