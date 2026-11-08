import express, { type Request } from 'express';
import type { Pool } from 'pg';
import { transaction } from './database.js';
import { PosModel, type User } from './pos-model.js';
import { PgWebStore } from './web-store.js';
import { webRoutes } from '../routes/web-routes.js';
import { loginLimiter } from '../routes/pos-routes.js';
import { ApiError, integer } from '../models/validation.js';

function bearer(request: Request) {
  const header = request.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'Authentication required.');
  return header.slice(7);
}

function administrator(user: User) {
  if (user.role === 'cashier') throw new ApiError(403, 'Administrator access required.');
  return user;
}

export function createPostgresApp(pool: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_request, response) => { response.json({ status: 'ok' }); });
  app.use('/api/pos', webRoutes(work => transaction(pool, 'pos_web', db => work(new PgWebStore(db, process.env.POS_WEB_DEMO === '1')))));
  app.use(express.json({ limit: '16mb' }));
  app.use(['/api/v1/auth/login', '/api/v1/auth/password'], loginLimiter());

  const route = (method: 'get' | 'post', path: string, run: (model: PosModel, request: Request) => Promise<unknown>, status = 200) => {
    app[method](path, async (request, response) => {
      const result = await transaction(pool, 'pos_sync', async db => {
        try { return { data: await run(new PosModel(db), request), status }; }
        catch (error) {
          // Commit failed-login counters; model savepoints already rolled back invalid writes.
          if (error instanceof ApiError) return { data: { error: error.message }, status: error.status };
          throw error;
        }
      });
      response.status(result.status).json(result.data);
    });
  };
  route('post', '/api/v1/auth/login', (model, request) => model.login(request.body));
  route('post', '/api/v1/auth/password', async (model, request) => {
    await model.password(await model.session(bearer(request)), request.body); return { ok: true };
  });
  route('post', '/api/v1/users', async (model, request) => {
    const actor = administrator(await model.session(bearer(request)));
    return { user: await model.createUser(request.body, actor.role === 'superuser') };
  }, 201);
  route('post', '/api/v1/sync/push', async (model, request) => model.push(await model.device(bearer(request)), request.body?.changes));
  route('get', '/api/v1/sync/pull', async (model, request) => {
    await model.device(bearer(request)); return model.pull(integer(Number(request.query.after ?? 0)));
  });
  route('get', '/api/v1/reports/events', async (model, request) => {
    administrator(await model.session(bearer(request)));
    const after = integer(Number(request.query.after ?? 0));
    const rows = await model.db.prepare('SELECT rowid,device_id,entity,payload FROM events WHERE rowid>? ORDER BY rowid LIMIT 100').all(after);
    return { events: rows.map(row => ({ cursor: row.rowid, deviceId: row.device_id, entity: row.entity, payload: JSON.parse(String(row.payload)) })) };
  });
  app.use((_request, response) => { response.status(404).json({ error: 'Not found.' }); });
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) { next(error); return; }
    const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 :
      typeof error === 'object' && error && 'status' in error && error.status === 413 ? 413 : 503;
    if (status === 503) console.error('PostgreSQL request failed.', error instanceof Error ? error.name : 'Unknown error');
    response.status(status).json({ error: status === 503 ? 'Database unavailable. Please try again.' : error instanceof ApiError ? error.message : 'Invalid request body.' });
  });
  return app;
}
