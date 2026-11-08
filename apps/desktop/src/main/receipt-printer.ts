import type { WebContents } from 'electron';

export async function printReceipt(contents: Pick<WebContents, 'getPrintersAsync' | 'print'>) {
  const printers = await contents.getPrintersAsync();
  if (!printers.length) throw new Error('No printer detected. Connect and install your receipt printer.');
  await new Promise<void>((resolve, reject) => {
    contents.print({ silent: true, deviceName: printers.length === 1 ? printers[0].name : '', printBackground: true, color: false,
      margins: { marginType: 'none' }, usePrinterDefaultPageSize: true },
    (success, reason) => success ? resolve() : reject(new Error(reason || 'Printing failed.')));
  });
}
