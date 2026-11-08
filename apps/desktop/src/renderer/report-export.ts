export interface ReportData { title:string; shopName:string; period:string; category:string; headers:string[]; rows:(string|number)[][] }
export async function reportFile(report:ReportData,format:'pdf'|'xlsx'):Promise<Blob> {
  const context=`Date: ${report.period} | Category: ${report.category} | Amounts in QAR`;
  if(format==='xlsx') {
    const {default:ExcelJS}=await import('exceljs');
    const workbook=new ExcelJS.Workbook();
    const sheet=workbook.addWorksheet('Report');
    sheet.addRow([report.shopName]);sheet.addRow([report.title]);sheet.addRow([context]);sheet.addRow([]);
    sheet.addRow(report.headers);sheet.addRows(report.rows);
    for(const index of [1,2,3])sheet.mergeCells(index,1,index,report.headers.length);
    sheet.getRow(1).font={name:'Calibri',size:22,bold:true,color:{argb:'FF172554'}};
    sheet.getRow(1).height=34;
    sheet.getRow(2).font={name:'Calibri',size:14,bold:true,color:{argb:'FF334155'}};
    sheet.getRow(2).height=24;
    sheet.getRow(3).font={name:'Calibri',size:11,color:{argb:'FF475569'}};
    sheet.getRow(3).alignment={wrapText:true,vertical:'middle'};
    sheet.getRow(3).height=32;
    sheet.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};
    sheet.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1D4ED8'}};
    sheet.getRow(5).height=24;
    sheet.columns.forEach(column=>{column.width=24;});
    sheet.views=[{state:'frozen',ySplit:5}];
    return new Blob([await workbook.xlsx.writeBuffer() as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const [{jsPDF},{autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
  const pdf=new jsPDF({orientation:'landscape'});
  pdf.setFont('helvetica','bold');pdf.setFontSize(22);pdf.setTextColor(23,37,84);
  const shopLines=pdf.splitTextToSize(report.shopName,265);pdf.text(shopLines,14,18);
  const titleY=18+shopLines.length*9;
  pdf.setFontSize(14);pdf.text(report.title,14,titleY);
  pdf.setFont('helvetica','normal');pdf.setFontSize(10);pdf.setTextColor(71,85,105);
  const contextLines=pdf.splitTextToSize(context,265);pdf.text(contextLines,14,titleY+9);
  autoTable(pdf,{startY:titleY+14+contextLines.length*5,head:[report.headers],body:report.rows,styles:{fontSize:8,overflow:'linebreak'},headStyles:{fillColor:[29,78,216]},margin:14});
  return pdf.output('blob');
}
