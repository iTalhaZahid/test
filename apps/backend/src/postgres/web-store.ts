import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PgDatabase } from './database.js';
import { AuthStore } from './auth-store.js';
import { ManagementStore } from './management-store.js';
import { SalesStore } from './sales-store.js';
import type { LocalUser } from '../../../desktop/src/main/auth-contract';
export class PgWebStore {
    readonly auth: AuthStore;
    readonly management: ManagementStore;
    readonly sales: SalesStore;
    readonly ready: Promise<void>;
    private readonly db: PgDatabase;
    constructor(db: PgDatabase, readonly demo: boolean, keyValue = process.env.POS_WEB_ENCRYPTION_KEY) {
        if (!keyValue || !/^[a-f0-9]{64}$/i.test(keyValue))
            throw new Error('POS_WEB_ENCRYPTION_KEY must be a 32-byte hexadecimal key.');
        const key = Buffer.from(keyValue, 'hex');
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
        this.db = db;
        this.auth = new AuthStore(db, { encrypt: async (value) => encrypt(value), decrypt: async (value) => decrypt(value) }, demo);
        this.management = new ManagementStore(db, demo);
        this.sales = new SalesStore(db, encrypt);
        this.ready = Promise.resolve();
    }
    async user(token: string | undefined): Promise<LocalUser | null> {
        if (!token || !this.demo)
            return null;
        const row = (await this.db.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.is_superuser,
          r.id AS profile_id,r.shop_id,r.manage_finance FROM web_sessions s
          JOIN local_users u ON u.id=s.user_id
          LEFT JOIN development_records r ON r.id=u.id
          WHERE s.token=? AND s.expires>? AND COALESCE(r.archived,0)=0`)
            .get((await this.hash(token)), Date.now()));
        return row ? { id:String(row.id),username:String(row.username),displayName:String(row.display_name),
            role:row.is_superuser===1?'superuser':row.role==='admin'?'admin':'cashier',
            manageCreditsExpenses:row.manage_finance===1,shopId:row.profile_id?String(row.shop_id):undefined } : null;
    }
    async session(user: LocalUser, lifetime = 8 * 60 * 60 * 1000) {
        const token = randomBytes(32).toString('hex');
        (await this.db.prepare("DELETE FROM web_sessions WHERE expires<=?").run(Date.now()));
        (await this.db.prepare("INSERT INTO web_sessions VALUES(?,?,?)").run((await this.hash(token)), user.id, Date.now() + lifetime));
        return token;
    }
    async logout(token: string | undefined) {
        if (token)
            (await this.db.prepare("DELETE FROM web_sessions WHERE token=?").run((await this.hash(token))));
    }
    private async hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
    async execute(token: string | undefined, operation: string, args: unknown[]) {
        const user = (await this.user(token));
        if (!user)
            throw new Error('Sign in to continue.');
        const [first, second] = args;
        switch (operation) {
            case 'auth:change-password':
                return (await this.auth.changePassword(user.id, first, second, async () => (await this.user(token))?.id === user.id));
            case 'management:list': return (await this.management.list(user, first, second));
            case 'management:remove': return (await this.management.remove(user, first, second));
            case 'management:save': {
                const candidate = first as {
                    kind?: string;
                    password?: unknown;
                    username?: unknown;
                } | null;
                if ((candidate?.kind === 'cashier' || candidate?.kind === 'admin') && (typeof candidate.username !== 'string' || !candidate.username.trim()))
                    throw new Error('Username required.');
                const verifier = (candidate?.kind === 'cashier' || candidate?.kind === 'admin') && candidate.password ? await (await this.auth.cashierVerifier(candidate.password)) : undefined;
                const currentUser=await this.user(token);
                if (!currentUser)
                    throw new Error('Session changed.');
                return (await this.management.save(currentUser, first, verifier));
            }
            case 'management:monthly': return (await this.management.monthly(user, first));
            case 'management:record-payment': return (await this.management.recordPayment(user, first, second, args[2], args[3]));
            case 'management:set-paid': return (await this.management.setPaid(user, first, second, args[2]));
            case 'sales:payment-methods': return (await this.sales.paymentMethods(user));
            case 'sales:menu': return (await this.sales.menu(user, first));
            case 'sales:favourite': return (await this.sales.favourite(user, first, second));
            case 'sales:creditors': return (await this.sales.creditors(user, first));
            case 'sales:save': return (await this.sales.save(user, first));
            case 'sales:history': return (await this.sales.history(user, first));
            case 'expenses:save': return (await this.sales.saveExpense(user, first));
            case 'expenses:list': return (await this.sales.expenses(user, first, second, args[2]));
            case 'creditors:account': return (await this.sales.creditorAccount(user, first));
            case 'creditors:recover': return (await this.sales.recoverCredit(user, first));
            case 'creditors:repayments': return (await this.sales.repayments(user, first, second, args[2]));
            default: throw new Error('Unknown operation.');
        }
    }
    async close() { (await this.sales.close()); (await this.management.close()); (await this.auth.close()); this.db.close(); }
}
