import type { WebContents } from 'electron';

export async function printReceipt(contents: Pick<WebContents, 'getPrintersAsync' | 'print'>) {
  const printers = await contents.getPrintersAsync();
  if (!printers.length) throw new Error('No printer detected. Connect and install your receipt printer.');
  const physical = printers.filter(printer => !/pdf|xps|onenote|fax/i.test(`${printer.name} ${printer.displayName} ${printer.description}`));
  if (!physical.length) throw new Error('Only file printers are installed. Connect your receipt printer to print without a Save As dialog.');
  await new Promise<void>((resolve, reject) => {
    contents.print({ silent: physical.length === 1, deviceName: physical[0].name, printBackground: true, color: false,
      margins: { marginType: 'none' }, usePrinterDefaultPageSize: true },
    (success, reason) => success ? resolve() : reject(new Error(reason || 'Printing failed.')));
  });
}
