import { useState, type ReactNode } from 'react';
import { SavedDialog } from './SavedDialog';
import { Download } from 'lucide-react';
import { reportFile, type ReportData } from './report-export';
export function ReportDownload({report,disabled,actions}:{report:ReportData;disabled:boolean;actions?:ReactNode}) {
  const [format,setFormat]=useState<'pdf'|'xlsx'>('pdf'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[downloaded,setDownloaded]=useState('');
  async function download(){
    setBusy(true);setError('');
    try{
      const blob=await reportFile(report,format),url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download=`${report.title.replace(/[^a-z0-9]+/gi,'-')}.${format}`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      setDownloaded(link.download);
    }catch{setError('Could not create the report. Please try again.');}finally{setBusy(false);}
  }
  return <div><div className="flex flex-wrap gap-2"><select aria-label="Download format" value={format} disabled={busy} onChange={e=>setFormat(e.target.value as 'pdf'|'xlsx')} className="rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="pdf">PDF</option><option value="xlsx">Excel (.xlsx)</option></select><button disabled={disabled||busy} onClick={()=>void download()} className="flex items-center gap-2 rounded-lg border border-blue-800 bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"><Download size={18} aria-hidden="true"/>{busy?'Preparing...':'Download report'}</button>{actions}</div><p className="mt-2 text-xs text-slate-500">Includes all records matching the filters, across every page.</p>{error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}{downloaded&&<SavedDialog title="Report ready" message={`${downloaded} has been generated and sent to your downloads. If prompted, choose where to save it.`} onClose={()=>setDownloaded('')}/>}</div>;
}
