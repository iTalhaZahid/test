import { useEffect, useState } from 'react';
import Aurora from './components/Aurora';

export function LoginVisual() {
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  return <aside className="relative m-3 hidden min-h-[570px] overflow-hidden rounded-[24px] bg-[#0b1640] text-white md:flex md:flex-col" aria-label="Welcome to POS">
    <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden="true">
      <Aurora colorStops={['#3266e3', '#66b8ed', '#244ac4']} amplitude={1.1} blend={0.65} speed={0.35} height={0.65} intro={false} paused={reducedMotion} dpr={1} />
    </div>
    <div className="relative z-10 flex flex-1 flex-col justify-between p-10 lg:p-12">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-blue-100">Built for your everyday.</span>
      </div>
      <div className="my-12 text-center">
        <h2 className="text-4xl leading-[1.16] font-medium tracking-tight lg:text-5xl">Salam Al Khayber</h2>
      </div>
      <p className="max-w-xs text-xs leading-5 text-blue-200/70">Made for the people behind the counter.</p>
    </div>
  </aside>;
}
