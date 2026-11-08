import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/pos/route';

test('catalog checks reuse unchanged data and return edits only after authenticated upstream success', async () => {
  const originalFetch = globalThis.fetch, originalUrl = process.env.BACKEND_URL;
  const data = [{ id: 'floor', name: 'Ground', tables: [1, 2] }];
  const version = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const request = () => new NextRequest('https://pos.example.com/api/pos', {
    method: 'POST', headers: { origin: 'https://pos.example.com', 'content-type': 'application/json', 'x-pos-catalog-version': version },
    body: JSON.stringify({ operation: 'management:list', args: ['floor', ''] }),
  });
  try {
    process.env.BACKEND_URL = 'https://data.example.com';
    globalThis.fetch = async () => Response.json({ data });
    assert.deepEqual(await (await POST(request())).json(), { unchanged: true });
    const updated = [{ ...data[0], tables: [1, 2, 3] }];
    globalThis.fetch = async () => Response.json({ data: updated });
    assert.deepEqual(await (await POST(request())).json(), { data: updated });
    globalThis.fetch = async () => Response.json({ error: 'Sign in to continue.' }, { status: 401 });
    assert.equal((await POST(request())).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = originalUrl;
  }
});

test('Vercel uses the backend binding and fails closed without it', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.BACKEND_URL;
  const originalVercel = process.env.VERCEL;
  const request = (origin = 'https://pos.example.com', args: unknown[] = []) => new NextRequest('https://pos.example.com/api/pos', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'pos-web-session=token' },
    body: JSON.stringify({ operation: 'auth:state', args }),
  });
  try {
    process.env.VERCEL = '1';
    delete process.env.BACKEND_URL;
    assert.equal((await POST(request())).status, 503);
    process.env.BACKEND_URL = 'http://backend.internal/';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(String(url), 'http://backend.internal/api/pos');
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('origin'), 'http://backend.internal');
      assert.equal(headers.get('cookie'), 'pos-web-session=token');
      assert.equal(options?.redirect, 'error');
      return new Response('{"data":null}', { headers: { 'Set-Cookie': 'pos-web-session=new; Path=/; HttpOnly; SameSite=Strict' } });
    };
    assert.equal((await POST(request('https://attacker.example'))).status, 403);
    assert.equal(calls, 0);
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(response.headers.get('set-cookie')!, /; Secure/);
    assert.deepEqual(await response.json(), { data: null });
    assert.equal((await POST(request(undefined, ['id', '2026-11', 25000, 'operation-id']))).status, 200);
    assert.equal((await POST(request(undefined, [1, 2, 3, 4, 5]))).status, 400);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal((await POST(request())).status, 502);
    process.env.BACKEND_URL = 'https://user:password@data.example.com';
    assert.equal((await POST(request())).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = originalUrl;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});

