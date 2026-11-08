import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '../../../server/store';

export const runtime = 'nodejs';
const cookieName = 'pos-web-session';

export async function POST(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  // NextURL normalizes 127.0.0.1 to localhost; browsers send the actual Host.
  const origin = `${request.nextUrl.protocol}//${request.headers.get('host') || new URL(request.url).host}`;
  if (request.headers.get('origin') !== origin ||
      request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return reply({ error: 'Untrusted request.' }, 403);
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > 2800000) return reply({ error: 'Request too large.' }, 413);
  let input;
  try { input = JSON.parse(body); } catch { return reply({ error: 'Invalid request.' }, 400); }
  if (!input || typeof input.operation !== 'string' || !Array.isArray(input.args) || input.args.length > 3) {
    return reply({ error: 'Invalid request.' }, 400);
  }
  if (process.env.POS_WEB_SERVER_URL) {
    try {
      const upstream = new URL(process.env.POS_WEB_SERVER_URL);
      if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.origin === origin) {
        throw new Error('Invalid data server URL.');
      }
      const response = await fetch(new URL('/api/pos', upstream), {
        method: 'POST', body, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Origin: upstream.origin,
          Cookie: request.headers.get('cookie') || '' },
      });
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      for (const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return reply({ error: 'Data server unavailable. Please try again.' }, 502);
    }
  }
  if (process.env.VERCEL) return reply({ error: 'POS_WEB_SERVER_URL must point to a persistent data server.' }, 503);
  const token = request.cookies.get(cookieName)?.value;
  try {
    const store = await getStore();
    const { operation, args } = input;
    if (operation === 'auth:state') return reply({ data: { user: store.user(token), demo: store.demo } });
    if (operation === 'auth:login' || operation === 'auth:logout') {
      store.logout(token);
      const result = operation === 'auth:login' ? await store.auth.login(args[0], args[1]) : null;
      const session = result?.ok ? store.session(result.user) : '';
      const response = reply({ data: result });
      response.cookies.set(cookieName, session, {
        httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:',
        path: '/', maxAge: session ? 8 * 60 * 60 : 0,
      });
      return response;
    }
    if (!store.user(token)) return reply({ error: 'Sign in to continue.' }, 401);
    return reply({ data: await store.execute(token, operation, args) ?? null });
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : 'Unable to complete the request. Please try again.';
    return reply({ error: message }, 400);
  }
}
