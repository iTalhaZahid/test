export function dailyTotals(rows: { date: string; amountMinor: number }[]) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.date, (totals.get(row.date) || 0) + row.amountMinor);
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([date, amountMinor]) => ({ date, amountMinor }));
}

export function chartScale(rows: { amountMinor: number }[]) {
  const maximum = rows.reduce((max, row) => Math.max(max, row.amountMinor), 0);
  if (maximum === 0) return { maximum: 100, ticks: [0, 25, 50, 75, 100] };
  const rawStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(1, Math.ceil(rawStep / magnitude) * magnitude);
  const ceiling = Math.ceil(maximum / step) * step;
  return { maximum: ceiling, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step) };
}

export function reportDate(date: string) {
  return date.split('-').reverse().join('-');
}

export function reportPeriod(start: string, end: string) {
  return start === end ? reportDate(start) : `${reportDate(start)} to ${reportDate(end)}`;
}
