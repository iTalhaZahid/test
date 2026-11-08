import { PgDatabase } from './database.js';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError, object, text, passwordText, upload, type Upload } from '../models/validation.js';
const derive = promisify(scrypt);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface User {
    id: string;
    username: string;
    displayName: string;
    role: 'superuser' | 'admin' | 'cashier';
    shopId: string;
    manageCreditsExpenses: boolean;
}
export class PosModel {
    readonly db: PgDatabase;
    constructor(db: PgDatabase) { this.db = db; }
    async bootstrap() {
        if ((await this.db.prepare("SELECT id FROM users LIMIT 1").get()))
            return;
        await (await this.createUser({ id: 'bootstrap-admin', username: 'superadmin', password: 'PosSuperAdmin123!', displayName: 'Super Administrator', role: 'superuser', shopId: 'main-shop', manageCreditsExpenses: true }, true));
    }
    async user(id: string): Promise<User | null> {
        const row = (await this.db.prepare("SELECT * FROM users WHERE id=? AND archived=0").get(id));
        return row ? { id: String(row.id), username: String(row.username), displayName: String(row.display_name), role: row.role as User['role'], shopId: String(row.shop_id), manageCreditsExpenses: !!row.manage_finance } : null;
    }
    private async change(entity: string, key: string, payload: unknown): Promise<number> {
        const data = JSON.stringify(payload);
        const version = Number((await this.db.prepare("INSERT INTO changes(entity,key,payload) VALUES(?,?,?) RETURNING version").run(entity, key, data)).lastInsertRowid);
        (await this.db.prepare("INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(entity,key) DO UPDATE SET payload=excluded.payload,version=excluded.version").run(entity, key, data, version));
        return version;
    }
    async createUser(value: unknown, superuser: boolean) {
        const body = object(value), username = text(body.username, 64), password = passwordText(body.password), displayName = text(body.displayName), shopId = text(body.shopId, 64);
        if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || password.length < 8 || !['cashier', 'admin', 'superuser'].includes(String(body.role)) || (body.role !== 'cashier' && !superuser))
            throw new ApiError(400, 'Invalid account or role.');
        const id = body.id ? text(body.id, 64) : randomUUID(), salt = randomBytes(16).toString('hex'), hash = (await derive(password, salt, 64) as Buffer).toString('hex');
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            (await this.db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,shop_id,manage_finance) VALUES(?,?,?,?,?,?,?,?)").run(id, username, displayName, String(body.role), salt, hash, shopId, body.manageCreditsExpenses === true ? 1 : 0));
            (await this.change('user', id, (await this.user(id))));
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
        return (await this.user(id));
    }
    async login(value: unknown) {
        const body = object(value), username = text(body.username, 64), password = passwordText(body.password), deviceId = text(body.deviceId, 64);
        if (!/^[a-f\d-]{36}$/i.test(deviceId))
            throw new ApiError(400, 'Invalid device ID.');
        const row = (await this.db.prepare("SELECT * FROM users WHERE lower(username)=lower(?)").get(username));
        if (row && Number(row.blocked_until) > Date.now())
            throw new ApiError(429, 'Too many attempts. Try again in 30 seconds.');
        const actual = await derive(password, row ? String(row.salt) : 'unknown-user', 64) as Buffer;
        if (!row || row.archived || !timingSafeEqual(actual, Buffer.from(String(row.hash), 'hex'))) {
            if (row)
                (await this.db.prepare("UPDATE users SET failures=failures+1,blocked_until=CASE WHEN failures>=4 THEN ? ELSE 0 END WHERE id=?").run(Date.now() + 30000, row.id));
            throw new ApiError(401, 'Username or password is incorrect.');
        }
        const user = (await this.user(String(row.id)))!;
        const device = (await this.db.prepare("SELECT * FROM devices WHERE id=?").get(deviceId));
        let deviceToken: string;
        if (!device) {
            if (user.role === 'cashier')
                throw new ApiError(403, 'An administrator must pair this terminal first.');
            if ((await this.db.prepare("SELECT id FROM devices LIMIT 1").get()))
                throw new ApiError(409, 'This business already has a paired terminal. Contact support before replacing it.');
            deviceToken = randomBytes(32).toString('hex');
            (await this.db.prepare("INSERT INTO devices VALUES(?,?)").run(deviceId, digest(deviceToken)));
        }
        else {
            if (typeof body.deviceToken === 'string' && digest(body.deviceToken) === device.token_hash)
                deviceToken = body.deviceToken;
            else {
                if (user.role === 'cashier')
                    throw new ApiError(403, 'An administrator must restore this terminal pairing.');
                // Recover a pairing whose very first response was lost after the server committed.
                deviceToken = randomBytes(32).toString('hex');
                (await this.db.prepare("UPDATE devices SET token_hash=? WHERE id=?").run(digest(deviceToken), deviceId));
            }
        }
        (await this.db.prepare("UPDATE users SET failures=0,blocked_until=0 WHERE id=?").run(user.id));
        const token = randomBytes(32).toString('hex'), expiresAt = Date.now() + 30 * 86400000;
        (await this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now()));
        (await this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(token), user.id, expiresAt));
        return { user, token, deviceToken, expiresAt };
    }
    async session(token: string): Promise<User> {
        const row = (await this.db.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires>?").get(digest(token), Date.now()));
        const user = row && (await this.user(String(row.user_id)));
        if (!user)
            throw new ApiError(401, 'Sign in online again.');
        return user;
    }
    async device(token: string): Promise<string> {
        const row = (await this.db.prepare("SELECT id FROM devices WHERE token_hash=?").get(digest(token)));
        if (!row)
            throw new ApiError(401, 'Terminal pairing required.');
        return String(row.id);
    }
    async password(user: User, value: unknown) {
        const body = object(value), current = passwordText(body.current), next = passwordText(body.next);
        if (next.length < 8)
            throw new ApiError(400, 'Use at least eight characters.');
        const row = (await this.db.prepare("SELECT salt,hash FROM users WHERE id=?").get(user.id))!;
        if (!timingSafeEqual(await derive(current, String(row.salt), 64) as Buffer, Buffer.from(String(row.hash), 'hex')))
            throw new ApiError(401, 'Current password is incorrect.');
        const salt = randomBytes(16).toString('hex'), hash = (await derive(next, salt, 64) as Buffer).toString('hex');
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            (await this.db.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").run(salt, hash, user.id));
            (await this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id));
            (await this.change('user', user.id, (await this.user(user.id))));
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
    }
    async push(deviceId: string, input: unknown) {
        if (!Array.isArray(input) || input.length > 50)
            throw new ApiError(400, 'Send at most 50 changes.');
        const rows = input.map(upload);
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            const acknowledgements = (await Promise.all(rows.map(async (row) => (await this.accept(deviceId, row)))));
            (await this.db.exec("COMMIT"));
            return { acknowledgements };
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
    }
    private async accept(deviceId: string, row: Upload) {
        const payload = JSON.stringify(row.payload);
        const receipt = (await this.db.prepare("SELECT * FROM sync_receipts WHERE device_id=? AND entity=? AND key=? AND revision=?").get(deviceId, row.entity, row.key, row.revision));
        if (receipt) {
            if (receipt.payload_hash !== digest(payload))
                throw new ApiError(409, 'Sync reference belongs to different data.');
            return { entity: row.entity, key: row.key, revision: row.revision, version: Number(receipt.version) };
        }
        let version = 0;
        if (['sale', 'expense', 'repayment'].includes(row.entity)) {
            const previous = (await this.db.prepare("SELECT payload FROM events WHERE device_id=? AND entity=? AND key=?").get(deviceId, row.entity, row.key));
            if (previous && previous.payload !== payload)
                throw new ApiError(409, 'A saved financial entry cannot be changed.');
            if (!previous)
                (await this.db.prepare("INSERT INTO events VALUES(?,?,?,?)").run(deviceId, row.entity, row.key, payload));
        }
        else {
            const previous = (await this.db.prepare("SELECT * FROM documents WHERE entity=? AND key=?").get(row.entity, row.key));
            if (previous?.payload === payload)
                version = Number(previous.version);
            else {
                if ((previous ? Number(previous.version) : 0) !== row.baseVersion)
                    throw new ApiError(409, `Sync conflict for ${row.entity} ${row.key}. Local changes were retained.`);
                if (row.entity === 'user') {
                    const p = row.payload, v = object(p.verifier);
                    const existing = (await this.db.prepare("SELECT role FROM users WHERE id=?").get(row.key));
                    if (p.is_superuser || existing?.role === 'superuser')
                        throw new ApiError(403, 'Superuser credentials must be managed on the server.');
                    const profile = (await this.db.prepare("SELECT payload FROM documents WHERE entity='record' AND key=?").get(row.key));
                    const data = profile ? JSON.parse(String(profile.payload)) : {};
                    (await this.db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,shop_id,manage_finance,archived) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,role=excluded.role,salt=excluded.salt,hash=excluded.hash,shop_id=excluded.shop_id,manage_finance=excluded.manage_finance,archived=excluded.archived").run(row.key, String(p.username), String(p.display_name), String(p.role), String(v.salt), String(v.hash), String(data.shop_id || 'main-shop'), data.manage_finance ? 1 : 0, data.archived ? 1 : 0));
                    // Password verifiers never appear in the change feed or report responses.
                    version = (await this.change(row.entity, row.key, (await this.user(row.key)) ?? { id: row.key, archived: true }));
                }
                else {
                    version = (await this.change(row.entity, row.key, row.payload));
                    if (row.entity === 'record' && ['cashier', 'admin'].includes(String(row.payload.kind))) {
                        const p = row.payload;
                        (await this.db.prepare("UPDATE users SET display_name=?,shop_id=?,manage_finance=?,archived=? WHERE id=?").run(String(p.name), String(p.shop_id), Number(p.manage_finance), Number(p.archived), row.key));
                        if (p.archived)
                            (await this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.key));
                    }
                }
            }
        }
        (await this.db.prepare("INSERT INTO sync_receipts VALUES(?,?,?,?,?,?)").run(deviceId, row.entity, row.key, row.revision, digest(payload), version));
        return { entity: row.entity, key: row.key, revision: row.revision, version };
    }
    async pull(after: number) {
        const candidates = (await this.db.prepare("SELECT * FROM changes WHERE version>? ORDER BY version LIMIT 20").all(after));
        let bytes = 0;
        const rows = candidates.filter(row => { bytes += Buffer.byteLength(String(row.payload)); return bytes < 10000000; });
        return { changes: rows.map(row => ({ entity: row.entity, key: row.key, version: row.version, payload: JSON.parse(String(row.payload)) })), cursor: rows.length ? Number(rows.at(-1)!.version) : after, hasMore: rows.length < candidates.length || candidates.length === 20 };
    }
    async close() { this.db.close(); }
}
