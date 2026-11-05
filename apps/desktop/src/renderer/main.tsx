import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="flex min-h-screen flex-col bg-stone-50 font-sans text-emerald-950">
      <header className="flex justify-between gap-4 border-b border-stone-300 px-10 py-6"><strong>POS Terminal</strong><span className="text-sm text-stone-600">Development foundation</span></header>
      <section aria-labelledby="welcome" className="flex-1 px-10 py-14">
        <p className="text-xs font-bold tracking-widest">YOUR BUSINESS / YOUR TERMINAL</p>
        <h1 id="welcome" className="my-6 text-5xl leading-tight font-semibold tracking-tight">Ready for the<br />next milestone.</h1>
        <p className="leading-relaxed">This terminal opens independently, even without an internet connection.</p>
        <div className="mt-9 border-l-3 border-emerald-700 pl-5"><h2 className="text-lg font-semibold">Workspace ready</h2><p className="mt-1 leading-relaxed">Sign-in and transaction entry are not available yet.</p></div>
      </section>
      <footer className="px-10 py-6 text-sm text-stone-600">Windows terminal · PKR · Asia/Karachi</footer>
    </main>
  </StrictMode>,
);
