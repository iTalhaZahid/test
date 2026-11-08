import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrinterInfo, WebContentsPrintOptions } from 'electron';
import { printReceipt } from './receipt-printer';

test('receipt printing detects printers, uses the OS default and reports spooler failures', async () => {
  let printers: PrinterInfo[] = [];
  const calls: WebContentsPrintOptions[] = [];
  let success = true;
  const contents = {
    getPrintersAsync: async () => printers,
    print: (value: WebContentsPrintOptions, callback?: (success: boolean, reason: string) => void) => {
      calls.push(value); callback?.(success, success ? '' : 'Printer offline');
    },
  };
  await assert.rejects(printReceipt(contents), /No printer detected/);
  assert.equal(calls.length, 0);
  printers = [{ name: 'Thermal 80', displayName: 'Receipt', description: '', options: {} }];
  await printReceipt(contents);
  assert.equal(calls.at(-1)?.deviceName, 'Thermal 80');
  assert.equal(calls.at(-1)?.silent, true);
  assert.equal(calls.at(-1)?.usePrinterDefaultPageSize, true);
  printers.push({ ...printers[0], name: 'Office' });
  await printReceipt(contents);
  assert.equal(calls.at(-1)?.deviceName, '');
  success = false;
  await assert.rejects(printReceipt(contents), /Printer offline/);
});
