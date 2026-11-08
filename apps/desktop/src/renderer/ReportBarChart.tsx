import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartScale, dailyTotals, reportDate } from './report-chart-data';

export function ReportBarChart({ title, rows, color, context, tall=false }: { tall?:boolean; title: string; context: string; rows: { date: string; amountMinor: number }[]; color: string }) {
  const data = dailyTotals(rows);
  const scale = chartScale(data);

  return <figure className="min-w-0 rounded-xl border border-slate-300 bg-slate-100 p-4">
    <figcaption className="mb-2 font-semibold">{title} <span className="text-sm font-normal text-slate-500">(QAR per day)</span></figcaption>
    <p className="mb-3 text-xs text-slate-600">{context}</p>
    {!data.length ? <p className={`${tall?'h-80 lg:h-96':'h-56'} flex items-center justify-center text-center text-sm text-slate-500`}>No records match these filters.</p> : <div className={`${tall?'h-80 lg:h-96':'h-56'} relative w-full min-w-0 pl-7`}>
      <span className="report-axis-label">Amount (QAR)</span>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart key={context} data={data} accessibilityLayer margin={{ top: 8, right: 16, bottom: 20, left: 18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis height={48} label={{ value: 'Date', position: 'insideBottom', offset: -4 }} dataKey="date" tick={{ fontSize: 12 }} minTickGap={32} tickFormatter={value => reportDate(String(value))} />
          <YAxis width={76} domain={[0, scale.maximum]} ticks={scale.ticks} tick={{ fontSize: 12 }} tickFormatter={value => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(Number(value) / 100)} />
          <Tooltip isAnimationActive={false} cursor={{ fill: '#e2e8f0', fillOpacity: 0.5 }} content={({active,payload,label}) => active && payload?.length ? <div className="max-w-xs rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"><p className="font-semibold">{reportDate(String(label))}</p><p className="my-1">{title}: QAR {(Number(payload[0].value)/100).toFixed(2)}</p><p className="text-xs text-slate-500">{context}</p></div> : null} />
          <Bar dataKey="amountMinor" name={title} fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>}
    <p className={`mt-2 text-xs text-slate-500 ${data.length?'':'invisible'}`}>Hover over a bar or focus the chart and use arrow keys for details.</p>
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-blue-700">View daily totals</summary>
      <table className="mt-3 w-full text-left"><thead><tr><th scope="col">Date</th><th scope="col">Amount (QAR)</th></tr></thead><tbody>{data.map(row => <tr key={row.date}><td>{reportDate(row.date)}</td><td>{(row.amountMinor / 100).toFixed(2)}</td></tr>)}</tbody></table>
    </details>
  </figure>;
}
