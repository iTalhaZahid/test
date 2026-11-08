import { useEffect, useState } from 'react';
import { LoadingSkeleton } from './LoadingSkeleton';
import type { ManagementRecord } from '../main/management-contract';

export function ShopSelect({ value, onChange, includeAll = false, disabled = false, onLabelChange, onLoadingChange }: {
  value: string; onChange: (value: string) => void; includeAll?: boolean; disabled?: boolean; onLabelChange?: (label: string) => void;onLoadingChange?:(loading:boolean)=>void;
}) {
  const [shops, setShops] = useState<ManagementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    onLoadingChange?.(true);
    window.posManagement.list('shop', '').then(rows => { if (active) setShops(rows); })
      .catch(() => { if (active) setError('Could not load shops. Reopen this screen to retry.'); })
      .finally(() => { if (active) {setLoading(false);onLoadingChange?.(false);} });
    return () => { active = false; };
  }, [onLoadingChange]);
  useEffect(() => { onLabelChange?.(value === '__legacy__' ? 'Unassigned (legacy)' : value ? shops.find(shop => shop.id === value)?.name || 'Selected shop' : 'All shops'); }, [value, shops, onLabelChange]);
  return <div>
    <label className="grid gap-1 text-sm">{includeAll ? 'Shop' : 'Collection shop'}
      {loading?<LoadingSkeleton label="Loading shops" variant="field"/>:<select className="rounded-lg border border-slate-300 bg-white p-2 text-slate-900" required={!includeAll}
        disabled={disabled || loading} value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{includeAll ? 'All shops' : 'Choose a shop'}</option>
        {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
        {includeAll && <option value="__legacy__">Unassigned (legacy)</option>}
      </select>}
    </label>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
