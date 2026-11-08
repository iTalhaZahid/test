import { useEffect, useState, type FormEvent } from 'react';
import type {} from './env';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import type { AuthState } from '../main/auth-contract';
import { LoginVisual } from './LoginVisual';
import { AdminHome } from './AdminHome';
import { CashierHome } from './CashierHome';
import { ConfirmDialog } from './ConfirmDialog';
import { LoadingSkeleton } from './LoadingSkeleton';
import { activateCatalogSession, endCatalogSession, warmCatalog } from './catalog-cache';

export function LoginScreen({ platform = 'desktop' }: { platform?: 'desktop' | 'web' }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  useEffect(()=>{if(!state)return;if(state.user){activateCatalogSession(state.user.id);void warmCatalog();}else endCatalogSession();},[state]);

  useEffect(() => {
    let active = true;
    window.posAuth.state().then(value => { if (active) setState(value); })
      .catch(() => { if (active) setError('Unable to open local sign-in. Please restart POS.'); });
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    endCatalogSession();
    try {
      const result = await window.posAuth.login(username, password);
      if (result.ok) {
        setState(previous => ({ demo: previous?.demo ?? false, user: result.user }));
        setPassword('');
        setShowPassword(false);
      } else {
        setError(result.message);
      }
    } catch {
      setError('Unable to sign in. Please restart POS and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    endCatalogSession();
    setConfirmLogout(false);
    setBusy(true);
    setError('');
    try {
      await window.posAuth.logout();
      setState(previous => ({ demo: previous?.demo ?? false, user: null }));
      setPassword('');
    } catch {
      setError('Unable to sign out. Please close POS to end your session.');
    } finally {
      setBusy(false);
    }
  }

  if(!state&&!error)return <main className="grid min-h-dvh bg-white md:grid-cols-2"><LoginVisual/><section className="flex items-center px-8 py-12 lg:px-16"><LoadingSkeleton label="Loading sign-in" variant="page"/></section></main>;
  if (state?.user) return <>
    {state.user.role !== 'cashier' ? <AdminHome user={state.user} onLogout={async () => setConfirmLogout(true)} busy={busy} error={error} /> : <CashierHome user={state.user} onLogout={async () => setConfirmLogout(true)} error={error} />}
    {confirmLogout && <ConfirmDialog title="Sign out?" message="End this session and return to the login screen?" onCancel={() => setConfirmLogout(false)} onConfirm={() => void logout()} />}
  </>;

  return <main className="grid min-h-dvh bg-white font-sans text-slate-900 md:grid-cols-[1fr_1fr]">
    <LoginVisual />
    <section className="flex min-h-dvh flex-col px-8 py-7 lg:px-16" aria-label="Account access">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Point of sale</span>
      </div>
      <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-10">
        <>

          <h1 className="text-[32px] leading-tight font-semibold tracking-tight">Welcome back.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Sign in to your {platform === 'web' ? 'account' : 'terminal'} to get started.</p>
          <form onSubmit={login} className="mt-8" aria-busy={busy}>
            <label htmlFor="username" className="mb-2 block text-sm font-medium">Username</label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute top-3.5 left-4 text-slate-400" size={18} aria-hidden="true" />
              <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={64} required
                value={username} onChange={event => { setUsername(event.target.value); setError(''); }}
                className="login-input" placeholder="Enter your username" disabled={busy}
                aria-describedby={error ? 'login-error' : undefined} />
            </div>
            <label htmlFor="password" className="mt-5 mb-2 block text-sm font-medium">Password</label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-3.5 left-4 text-slate-400" size={18} aria-hidden="true" />
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={128} required
                value={password} onChange={event => { setPassword(event.target.value); setError(''); }}
                className="login-input pr-12" placeholder="Enter your password" disabled={busy}
                aria-describedby={error ? 'login-error' : undefined} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword} className="absolute top-0 right-0 grid size-12 place-items-center rounded-r-lg text-slate-500 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
            <button type="submit" disabled={busy || !state} className="primary-button mt-7">
              {busy ? 'Signing in…' : !state ? 'Sign-in unavailable' : 'Sign in'}<ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
          {state && platform==='desktop' && !window.posOnline && (!state.demo || window.posSync) && <p className="mt-6 text-sm leading-6 text-slate-600">Connect to the POS server for your first sign-in. Previously verified users can sign in offline on this device.</p>}
          {window.posOnline && <p className="mt-6 text-sm leading-6 text-slate-600">Internet is required to sign in and save transactions. Shared catalogs stay cached after sign-out.</p>}
        </>
        {error && <p id="login-error" role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">{error}</p>}
      </div>
      <footer className="flex items-center justify-between gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden="true" />{platform === 'web' ? 'Secure browser session' : 'On this device'}</span><span>POS {platform === 'web' ? 'web' : 'desktop'} · v0.1</span>
      </footer>
    </section>
  </main>;
}
