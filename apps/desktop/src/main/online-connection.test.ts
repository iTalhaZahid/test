import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOnlineConnection } from './online-connection';

test('online verification requires a database-backed POS response and preserves request security', async () => {
  const endpoint = 'https://pos.example.com';
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, `${endpoint}/api/pos`);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.credentials, 'include');
    assert.deepEqual(JSON.parse(String(options?.body)), { operation: 'auth:state', args: [] });
    assert.equal(new Headers(options?.headers).get('Origin'), endpoint);
    return Response.json({ data: { user: null, demo: false } });
  };
  assert.equal((await verifyOnlineConnection(endpoint, fetcher)).state, 'online');
  assert.equal((await verifyOnlineConnection(endpoint, async () => Response.json({ status: 'ok' }))).state, 'error');
  assert.equal((await verifyOnlineConnection(endpoint, async () => new Response('Database unavailable', { status: 503 }))).state, 'error');
  assert.equal((await verifyOnlineConnection(endpoint, async () => { throw new Error('secret connection string'); })).state, 'offline');
  assert.doesNotMatch(JSON.stringify(await verifyOnlineConnection(endpoint, async () => { throw new Error('secret'); })), /secret/);
});
