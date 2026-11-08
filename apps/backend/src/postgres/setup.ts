import { PgDatabase, transaction } from './database.js';
import { PgWebStore } from './web-store.js';
import { PosModel } from './pos-model.js';
import type { Pool } from 'pg';

export async function seedWeb(db: PgDatabase, demo: boolean) {
  for (const [id, name, category] of [['payment-cash','Cash','cash'],['payment-card','Card','card'],['payment-online','Online','online']]) {
    await db.prepare(`INSERT INTO development_records(id,kind,name,phone,passport,identity,"pricePaisa",quantity,payment_category)
      VALUES(?,'payment',?,'','','',0,0,?) ON CONFLICT DO NOTHING`).run(id,name,category);
  }
  await db.prepare(`INSERT INTO development_records(id,kind,name,phone,passport,identity,"pricePaisa",quantity)
    VALUES('main-shop','shop','Main shop','','','',0,0) ON CONFLICT DO NOTHING`).run();
  for (const [category, names] of [
    ['employee-category', ['Driver','Waiter','Kitchen Staff']],
    ['expense-category', ['Salary','Electricity','Rent','Supplies','Utilities','Transport','Maintenance','Other']],
  ] as const) {
    for (const name of names) await db.prepare(`INSERT INTO development_records(id,kind,name,phone,passport,identity,"pricePaisa",quantity)
      VALUES(?,?,?,'','','',0,0) ON CONFLICT DO NOTHING`).run(`${category}-${name.toLowerCase().replaceAll(' ','-')}`,category,name);
  }
  const store = new PgWebStore(db, demo);
  await store.auth.initialize();
  if (demo) await store.management.seed(await store.auth.cashierVerifier('PosCashier123!'));
}

export async function bootstrap(pool: Pool) {
  await transaction(pool, 'pos_sync', db => new PosModel(db).bootstrap());
  await transaction(pool, 'pos_web', db => seedWeb(db, process.env.POS_WEB_DEMO === '1'));
}
