import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'POS Admin', description: 'POS business administration' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="bg-stone-50 font-sans text-emerald-950">{children}</body></html>;
}
