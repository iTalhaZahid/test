import { Router, json } from 'express';
import { getStore } from '../models/web-store.js';

export function webRoutes() {
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
      const store = await getStore();
      const { operation, args } = input;
      if (operation === 'auth:state') {
        response.json({ data: { user: store.user(token), demo: store.demo } }); return;
      }
      if (operation === 'auth:login' || operation === 'auth:logout') {
        store.logout(token);
        const result = operation === 'auth:login' ? await store.auth.login(args[0], args[1]) : null;
        const session = result?.ok ? store.session(result.user) : '';
        response.cookie('pos-web-session', session, {
          httpOnly: true, sameSite: 'strict', secure: protocol === 'https',
          path: '/', maxAge: session ? 8 * 60 * 60 * 1000 : 0,
        });
        response.json({ data: result }); return;
      }
      if (!store.user(token)) { response.status(401).json({ error: 'Sign in to continue.' }); return; }
      response.json({ data: await store.execute(token, operation, args) ?? null });
    } catch (error) {
      const message = error instanceof Error && !('code' in error) ? error.message : 'Unable to complete the request. Please try again.';
      response.status(400).json({ error: message });
    }
  });
  return router;
}
