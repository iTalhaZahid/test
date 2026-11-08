import { Pool, types, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the safe range.');
  return number;
});

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required. Run neon deploy to pull it.');
  const url = new URL(connectionString);
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 5000 });
  if (process.env.VERCEL) attachDatabasePool(pool);
  pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
  return pool;
}

export class PgDatabase {
  private depth = 0;
  constructor(readonly client: PoolClient) {}

  prepare(sql: string) {
    let parameter = 0;
    const query = sql.replace(/\?/g, () => `$${++parameter}`);
    const execute = (values: unknown[]) => this.client.query<Record<string, unknown>>(query, values);
    return {
      all: async (...values: unknown[]) => (await execute(values)).rows,
      get: async (...values: unknown[]) => (await execute(values)).rows[0],
      run: async (...values: unknown[]) => {
        const result = await execute(values);
        return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.version };
      },
    };
  }

  async exec(sql: string) {
    if (sql === 'BEGIN IMMEDIATE') {
      await this.client.query(`SAVEPOINT operation_${++this.depth}`);
    } else if (sql === 'COMMIT') {
      await this.client.query(`RELEASE SAVEPOINT operation_${this.depth--}`);
    } else if (sql === 'ROLLBACK') {
      await this.client.query(`ROLLBACK TO SAVEPOINT operation_${this.depth}`);
      await this.client.query(`RELEASE SAVEPOINT operation_${this.depth--}`);
    } else {
      await this.client.query(sql);
    }
  }

  close() { /* The request transaction owns the pooled connection. */ }
}

export async function transaction<T>(pool: Pool, schema: 'pos_web' | 'pos_sync', run: (db: PgDatabase) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO ${schema}`);
    // One business per backend: serialize financial decisions and sync versions across instances.
    await client.query('SELECT pg_advisory_xact_lock($1)', [schema === 'pos_web' ? 71001 : 71002]);
    const value = await run(new PgDatabase(client));
    const commit = await client.query('COMMIT');
    if (commit.command !== 'COMMIT') throw new Error('Database transaction was rolled back.');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
