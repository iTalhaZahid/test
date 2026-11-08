import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

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
  if (!input || typeof input.operation !== 'string' || !Array.isArray(input.args) || input.args.length > 4) {
    return reply({ error: 'Invalid request.' }, 400);
  }
  const backendUrl = process.env.BACKEND_URL || (process.env.VERCEL ? undefined : 'http://127.0.0.1:4000');
  if (backendUrl) {
    try {
      const upstream = new URL(backendUrl);
      if (!['https:', 'http:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.origin === origin) {
        throw new Error('Invalid data server URL.');
      }
      const response = await fetch(new URL('api/pos', upstream), {
        method: 'POST', body, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Origin: upstream.origin,
          Cookie: request.headers.get('cookie') || '' },
      });
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      for (const cookie of response.headers.getSetCookie()) {
        headers.append('Set-Cookie', request.nextUrl.protocol === 'https:' && !/;\s*secure(?:;|$)/i.test(cookie) ? `${cookie}; Secure` : cookie);
      }
      const catalog = input.operation === 'sales:menu' && !input.args[0] || input.operation === 'sales:payment-methods' || input.operation === 'management:list' && ['floor', 'expense-category'].includes(input.args[0]) && !input.args[1];
      if (response.ok && catalog && request.headers.has('x-pos-catalog-version')) {
        const result = await response.json();
        const version = createHash('sha256').update(JSON.stringify(result.data)).digest('hex');
        return new Response(JSON.stringify(version === request.headers.get('x-pos-catalog-version') ? { unchanged: true } : result), { status: response.status, headers });
      }
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return reply({ error: 'Data server unavailable. Please try again.' }, 502);
    }
  }
  return reply({ error: 'Backend binding is unavailable.' }, 503);
}
