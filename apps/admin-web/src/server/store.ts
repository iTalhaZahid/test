import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AuthStore } from '../../../desktop/src/main/auth-store';
import { ManagementStore } from '../../../desktop/src/main/management-store';
import { SalesStore } from '../../../desktop/src/main/sales-store';
import type { LocalUser } from '../../../desktop/src/main/auth-contract';

export class WebStore {
  readonly auth: AuthStore;
  readonly management: ManagementStore;
  readonly sales: SalesStore;
  readonly ready: Promise<void>;
  private readonly db: DatabaseSync;

  constructor(directory: string, readonly demo: boolean) {
    mkdirSync(directory, { recursive: true });
    const keyFile = path.join(directory, 'protection.key');
    try { writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const key = readFileSync(keyFile);
    const encrypt = (value: string) => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    };
    const decrypt = (value: Buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    };
    const filename = path.join(directory, 'pos.sqlite');
    this.auth = new AuthStore(filename, { encrypt: async value => encrypt(value), decrypt: async value => decrypt(value) }, demo);
    this.management = new ManagementStore(filename, demo);
    this.sales = new SalesStore(filename, path.join(directory, 'recovery.sqlite'), encrypt);
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS web_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL) STRICT;`);
    this.ready = this.auth.initialize().then(async () => {
      if (demo) this.management.seed(await this.auth.cashierVerifier('PosCashier123!'));
    });
  }

  user(token: string | undefined): LocalUser | null {
    if (!token || !this.demo) return null;
    const row = this.db.prepare(`SELECT u.id,u.username,u.display_name,u.role FROM web_sessions s
      JOIN local_users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?
      AND NOT EXISTS(SELECT 1 FROM development_records r WHERE r.id=u.id AND r.archived=1)`)
      .get(this.hash(token), Date.now());
    return row ? this.auth.user(String(row.id)) : null;
  }

  session(user: LocalUser) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM web_sessions WHERE expires<=?').run(Date.now());
    this.db.prepare('INSERT INTO web_sessions VALUES(?,?,?)').run(this.hash(token), user.id, Date.now() + 8 * 60 * 60 * 1000);
    return token;
  }
  logout(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM web_sessions WHERE token=?').run(this.hash(token));
  }
  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }

  async execute(token: string | undefined, operation: string, args: unknown[]) {
    const user = this.user(token);
    if (!user) throw new Error('Sign in to continue.');
    const [first, second] = args;
    switch (operation) {
      case 'auth:change-password':
        return this.auth.changePassword(user.id, first, second, () => this.user(token)?.id === user.id);
      case 'management:list': return this.management.list(user, first, second);
      case 'management:remove': return this.management.remove(user, first, second);
      case 'management:save': {
        const candidate = first as { kind?: string; password?: unknown; username?: unknown } | null;
        if ((candidate?.kind === 'cashier' || candidate?.kind === 'admin') && (typeof candidate.username !== 'string' || !candidate.username.trim())) throw new Error('Username required.');
        const verifier = (candidate?.kind === 'cashier' || candidate?.kind === 'admin') && candidate.password ? await this.auth.cashierVerifier(candidate.password) : undefined;
        if (!this.user(token)) throw new Error('Session changed.');
        return this.management.save(this.user(token), first, verifier);
      }
      case 'management:monthly': return this.management.monthly(user, first);
      case 'management:record-payment': return this.management.recordPayment(user, first, second, args[2], args[3]);
      case 'management:set-paid': return this.management.setPaid(user, first, second, args[2]);
      case 'sales:payment-methods': return this.sales.paymentMethods(user);
      case 'sales:menu': return this.sales.menu(user, first);
      case 'sales:favourite': return this.sales.favourite(user, first, second);
      case 'sales:creditors': return this.sales.creditors(user, first);
      case 'sales:save': return this.sales.save(user, first);
      case 'sales:history': return this.sales.history(user, first);
      case 'expenses:save': return this.sales.saveExpense(user, first);
      case 'expenses:list': return this.sales.expenses(user, first, second, args[2]);
      case 'creditors:account': return this.sales.creditorAccount(user, first);
      case 'creditors:recover': return this.sales.recoverCredit(user, first);
      case 'creditors:repayments': return this.sales.repayments(user, first, second, args[2]);
      default: throw new Error('Unknown operation.');
    }
  }

  close() { this.sales.close(); this.management.close(); this.auth.close(); this.db.close(); }
}

const globalStore = globalThis as typeof globalThis & { posWebStore?: WebStore };
export async function getStore() {
  // Hot reload must replace cached services that still run old validation code.
  if (process.env.NODE_ENV !== 'production' && globalStore.posWebStore &&
      (!(globalStore.posWebStore instanceof WebStore) || !(globalStore.posWebStore.management instanceof ManagementStore) || !(globalStore.posWebStore.sales instanceof SalesStore))) {
    globalStore.posWebStore.close();
    delete globalStore.posWebStore;
  }
  // shortcut: one persistent Node server; use the backend before scaling to multiple hosts.
  const store = globalStore.posWebStore ??= new WebStore(
    path.resolve(/* turbopackIgnore: true */ process.env.POS_WEB_DATA_DIR || '.data'),
    process.env.NODE_ENV !== 'production' || process.env.POS_WEB_DEMO === '1',
  );
  await store.ready;
  return store;
}
