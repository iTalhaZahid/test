import { Router, json } from 'express';
import type { WebStore } from '../models/web-store.js';
import type { PgWebStore } from '../postgres/web-store.js';

type Run = <T>(work: (store: WebStore | PgWebStore) => Promise<T>, operation: string) => Promise<T>;

export function webRoutes(run: Run) {
  const router = Router();
  router.post('/', json({ limit: 2800000 }), async (request, response) => {
    const protocol = request.get('x-forwarded-proto')?.split(',')[0].trim() || request.protocol;
    const origin = `${protocol}://${request.get('host')}`;
    if (request.get('origin') !== origin || request.get('content-type')?.split(';')[0] !== 'application/json') {
      response.status(403).json({ error: 'Untrusted request.' }); return;
    }
    const input = request.body;
    if (!input || typeof input.operation !== 'string' || !Array.isArray(input.args) || input.args.length > 4) {
      response.status(400).json({ error: 'Invalid request.' }); return;
    }
    const token = request.headers.cookie?.split(';').map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith('pos-web-session='))?.slice('pos-web-session='.length);
    try {
      const result = await run<{ data: unknown; session?: string }>(async store => {
        const { operation, args } = input;
        if (operation === 'auth:state') return { data: { user: await store.user(token), demo: store.demo } };
        if (operation === 'auth:login' || operation === 'auth:logout') {
          await store.logout(token);
          const login = operation === 'auth:login' ? await store.auth.login(args[0], args[1]) : null;
          return { data: login, session: login?.ok ? await store.session(login.user) : '' };
        }
        return { data: await store.execute(token, operation, args) ?? null };
      }, input.operation);
      if (result.session !== undefined) {
        response.cookie('pos-web-session', result.session, {
          httpOnly: true, sameSite: 'strict', secure: protocol === 'https',
          path: '/', maxAge: result.session ? 8 * 60 * 60 * 1000 : 0,
        });
      }
      response.json({ data: result.data });
    } catch (error) {
      const message = error instanceof Error && !('code' in error) ? error.message : 'Unable to complete the request. Please try again.';
      response.status(message === 'Sign in to continue.' ? 401 : typeof error === 'object' && error && 'code' in error ? 503 : 400).json({ error: message });
    }
  });
  return router;
}
