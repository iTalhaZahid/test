import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool } from '../src/postgres/database.js';
import { bootstrap } from '../src/postgres/setup.js';

const directUrl = process.env.DATABASE_URL_UNPOOLED;
if (!directUrl) throw new Error('DATABASE_URL_UNPOOLED is required for migrations.');
if (new URL(directUrl).hostname.includes('-pooler')) throw new Error('Use a direct connection for migrations.');
const pool = createPool(directUrl);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(71000)');
  await client.query('CREATE TABLE IF NOT EXISTS public.pos_schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
    const sql = (await readFile(new URL(file, directory), 'utf8')).replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const version = file.slice(0, -4);
    const previous = await client.query('SELECT checksum FROM public.pos_schema_migrations WHERE version=$1', [version]);
    if (previous.rowCount && previous.rows[0].checksum !== checksum) throw new Error(`Applied migration ${version} changed. Add a new migration.`);
    if (!previous.rowCount) {
      await client.query(sql);
      await client.query('INSERT INTO public.pos_schema_migrations(version,checksum) VALUES($1,$2)', [version, checksum]);
    }
  }
  await client.query('COMMIT');
  console.log('PostgreSQL migrations applied or already current.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
try {
  await bootstrap(pool);
  console.log('Bootstrap users and catalog initialized without resetting existing accounts.');
} finally {
  await pool.end();
}
