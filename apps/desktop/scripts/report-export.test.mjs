import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {reportFile} from '../src/renderer/report-export.ts';
test('exports all report rows, PDF headings and multiple pages, and safe numeric Excel cells',async()=>{
 const report={title:'Credit History',shopName:'Main Shop',period:'01-11-2026 to 08-11-2026',category:'Creditor sales',headers:['Date','Customer','Amount (QAR)'],rows:Array.from({length:120},(_,i)=>['2026-11-08',i===0?'=1+1':`Customer ${i}`,12.5+i])};
 const pdf=await reportFile(report,'pdf');const text=await pdf.text();
 assert.ok(text.startsWith('%PDF'));assert.ok(text.includes('Main Shop'));assert.ok(text.includes('Credit History'));assert.ok(text.includes('Customer 119'));assert.ok((text.match(/\/Type \/Page\b/g)||[]).length>1);
 assert.ok(text.includes('Date: 01-11-2026 to 08-11-2026'));assert.ok(text.includes('Category: Creditor sales'));assert.ok(!text.includes('Salam Al Khayber'));
 const excel=await reportFile(report,'xlsx');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await excel.arrayBuffer());
 const sheet=workbook.worksheets[0];assert.equal(sheet.rowCount,125);assert.equal(sheet.getCell('A1').value,'Main Shop');assert.equal(sheet.getCell('B6').value,'=1+1');assert.equal(sheet.getCell('C6').value,12.5);assert.equal(sheet.getCell('B125').value,'Customer 119');assert.equal(sheet.getCell('A1').font.size,22);assert.equal(sheet.getCell('A2').value,'Credit History');assert.ok(sheet.getCell('A3').value.includes('Category: Creditor sales'));
});
