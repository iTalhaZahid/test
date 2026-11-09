import { PgDatabase } from './database.js';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { LocalUser, LoginResult } from '../../../desktop/src/main/auth-contract';
const deriveKey = promisify(scrypt);
const invalid = { ok: false as const, message: 'Username or password is incorrect.' };
export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'PosDemo123!';
export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'PosAdmin123!';
type Protection = {
    encrypt(value: string): Promise<Buffer>;
    decrypt(value: Buffer): Promise<string>;
};
export class AuthStore {
    private readonly db: PgDatabase;
    private busy = false;
    constructor(db: PgDatabase, private readonly protection: Protection, private readonly allowDemo: boolean) { this.db = db; }
    async initialize() {
        if (!this.allowDemo)
            return;
        for (const account of [
            { id: 'development-demo', username: DEMO_USERNAME, password: DEMO_PASSWORD, name: 'Demo cashier', role: 'cashier' },
            { id: 'development-admin', username: ADMIN_USERNAME, password: ADMIN_PASSWORD, name: 'Demo administrator', role: 'admin' },
            { id: 'development-superuser', username: 'superuser', password: 'PosSuper123!', name: 'Demo superuser', role: 'admin' },
        ]) {
            if ((await this.db.prepare("SELECT id FROM local_users WHERE lower(username)=lower(?)").get(account.username)))
                continue;
            const salt = randomBytes(16).toString('hex');
            const hash = await deriveKey(account.password, salt, 64) as Buffer;
            const verifier = await this.protection.encrypt(JSON.stringify({ salt, hash: hash.toString('hex') }));
            (await this.db.prepare("INSERT INTO local_users (id, username, display_name, verifier, is_demo, role) VALUES (?, ?, ?, ?, 1, ?)")
                .run(account.id, account.username, account.name, verifier, account.role));
            if (account.id === 'development-superuser')
                (await this.db.prepare("UPDATE local_users SET is_superuser=1 WHERE id=?").run(account.id));
        }
    }
    async cashierVerifier(password: unknown) {
        if (typeof password !== 'string' || password.length < 8 || password.length > 128)
            throw new Error('Use a password of 8–128 characters.');
        const salt = randomBytes(16).toString('hex');
        const hash = await deriveKey(password, salt, 64) as Buffer;
        return this.protection.encrypt(JSON.stringify({ salt, hash: hash.toString('hex') }));
    }
    async importVerifier(value: unknown) {
        const verifier = value as { salt?: unknown; hash?: unknown } | null;
        if (!verifier || typeof verifier.salt !== 'string' || !/^[a-f0-9]{32}$/i.test(verifier.salt) || typeof verifier.hash !== 'string' || !/^[a-f0-9]{128}$/i.test(verifier.hash)) throw new Error('Invalid offline account verifier.');
        return this.protection.encrypt(JSON.stringify({ salt: verifier.salt, hash: verifier.hash }));
    }
    async changePassword(userId: string, current: unknown, next: unknown, stillAuthorized: () => Promise<boolean>) {
        if (!this.allowDemo)
            throw new Error('Password changes require online provisioning in releases.');
        const row = (await this.db.prepare("SELECT username FROM local_users WHERE id=? AND is_demo=1").get(userId));
        if (!row)
            throw new Error('Active account required.');
        const login = await (await this.login(row.username, current));
        if (!login.ok)
            throw new Error(login.message);
        const verifier = await (await this.cashierVerifier(next));
        if (!(await stillAuthorized()))
            throw new Error('Session changed. Sign in again.');
        (await this.db.prepare("UPDATE local_users SET verifier=?,failed_attempts=0,blocked_until=0 WHERE id=?").run(verifier, userId));
    }
    async login(username: unknown, password: unknown): Promise<LoginResult> {
        if (typeof username !== 'string' || typeof password !== 'string' ||
            !username.trim() || username.length > 64 || !password || password.length > 128) {
            return { ok: false, message: 'Enter a username and password (maximum 64 and 128 characters).' };
        }
        if (this.busy)
            return { ok: false, message: 'A sign-in is already in progress. Please wait.' };
        this.busy = true;
        try {
            const row = (await this.db.prepare("SELECT * FROM local_users WHERE lower(username)=lower(?)").get(username.trim()));
            if (row && Number(row.blocked_until) > Date.now()) {
                return { ok: false, message: 'Too many attempts. Please wait 30 seconds and try again.' };
            }
            // Standard releases reject demo records, even if their database was copied.
            const archived = row && (await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='development_records'").get())
                && (await this.db.prepare("SELECT id FROM development_records WHERE id=? AND archived=1").get(row.id));
            const usable = row && !archived && (row.is_demo !== 1 || this.allowDemo);
            const verifier = usable
                ? JSON.parse(await this.protection.decrypt(Buffer.from(row.verifier as Uint8Array))) as {
                    salt: string;
                    hash: string;
                }
                : { salt: 'unknown-account', hash: '00'.repeat(64) };
            if (!/^[a-f0-9]{128}$/.test(verifier.hash) || typeof verifier.salt !== 'string')
                throw new Error('Invalid local verifier');
            const actual = await deriveKey(password, verifier.salt, 64) as Buffer;
            if (!usable || !timingSafeEqual(actual, Buffer.from(verifier.hash, 'hex'))) {
                if (row) {
                    const failures = Number(row.failed_attempts) + 1;
                    (await this.db.prepare("UPDATE local_users SET failed_attempts = ?, blocked_until = ? WHERE id = ?")
                        .run(failures >= 5 ? 0 : failures, failures >= 5 ? Date.now() + 30000 : 0, row.id));
                }
                return invalid;
            }
            (await this.db.prepare("UPDATE local_users SET failed_attempts = 0, blocked_until = 0 WHERE id = ?").run(row.id));
            const user = (await this.user(String(row.id)));
            if (!user)
                return invalid;
            return { ok: true, user };
        }
        finally {
            this.busy = false;
        }
    }
    async user(id: string): Promise<LocalUser | null> {
        const row = (await this.db.prepare("SELECT * FROM local_users WHERE id=?").get(id));
        if (!row || (row.is_demo === 1 && !this.allowDemo))
            return null;
        const hasRecords = (await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='development_records'").get());
        const profile = hasRecords ? (await this.db.prepare("SELECT * FROM development_records WHERE id=?").get(id)) : undefined;
        if (profile?.archived)
            return null;
        return { id: String(row.id), username: String(row.username), displayName: String(row.display_name),
            role: row.is_superuser === 1 ? 'superuser' : row.role === 'admin' ? 'admin' : 'cashier',
            manageCreditsExpenses: profile?.manage_finance === 1, shopId: profile ? String(profile.shop_id) : undefined };
    }
    async close() { this.db.close(); }
}
