import { PgDatabase } from './database.js';
import { randomUUID } from 'node:crypto';
import type { LocalUser } from '../../../desktop/src/main/auth-contract';
import type { ManagementRecord, MonthlyExpense, RecordKind } from '../../../desktop/src/main/management-contract';
import { restaurantMenu } from '../../../desktop/src/main/restaurant-menu';
function kind(value: unknown): RecordKind {
    if (typeof value !== 'string' || !['cashier', 'creditor', 'menu', 'shop', 'admin', 'payment', 'recurring', 'employee', 'employee-category', 'expense-category', 'floor'].includes(value))
        throw new Error('Invalid record type.');
    return value as RecordKind;
}
function text(value: unknown, limit: number, required = false): string {
    if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim()))
        throw new Error('Check the required fields and their lengths.');
    return value.trim();
}
// Development profiles are deliberately separate from provisioned login accounts.
export class ManagementStore {
    private db: PgDatabase;
    constructor(db: PgDatabase, private enabled: boolean, private provisioned = false) { this.db = db; }
    private async authorize(actor: unknown, category?: unknown, write = false) {
        const user = typeof actor === 'object' && actor ? actor as LocalUser : null;
        const role = user?.role || actor;
        if (!this.enabled)
            throw new Error('Local management is unavailable.');
        if (user && (await this.db.prepare("SELECT id FROM development_records WHERE id=? AND archived=1").get(user.id)))
            throw new Error('Inactive account.');
        if (category === 'admin' && role !== 'superuser')
            throw new Error('Superuser access required.');
        if (role === 'admin' || role === 'superuser')
            return;
        if (user && role === 'cashier' && !write && category === 'floor')
            return;
        if (user && role === 'cashier' && category === 'expense-category')
            return;
        if (user && role === 'cashier' && (category === 'creditor' || (!write && category === 'shop')) && (await this.db.prepare("SELECT id FROM development_records WHERE id=? AND archived=0 AND manage_finance=1").get(user.id)))
            return;
        throw new Error('Administrator access required.');
    }
    async seed(verifier: Buffer) {
        if (!this.enabled)
            return;
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            for (const [id, category, name, phone, price, quantity, username] of [
                ['sample-cashier-1', 'cashier', 'Sample Ayesha', '03000000001', 0, 0, 'cashier.ayesha'],
                ['sample-cashier-2', 'cashier', 'Sample Bilal', '03000000002', 0, 0, 'cashier.bilal'],
                ['sample-creditor-1', 'creditor', 'Sample Ahmed', '03000000003', 0, 0, ''],
                ['sample-creditor-2', 'creditor', 'Sample Sara', '03000000004', 0, 0, ''],
            ] as const) {
                const inserted = (await this.db.prepare("INSERT INTO development_records(id,kind,name,phone,passport,identity,\"pricePaisa\",quantity,username) VALUES(?,?,?,?,'','',?,?,?) ON CONFLICT DO NOTHING").run(id, category, name, phone, price, quantity, username));
                if (category === 'cashier' && inserted.changes)
                    (await this.db.prepare("INSERT INTO local_users(id,username,display_name,verifier,is_demo,role) VALUES(?,?,?,?,1,'cashier')").run(id, username, name, verifier));
            }
            // Include pre-existing login-only cashiers, including the built-in demo account.
            (await this.db.exec("INSERT INTO development_records(id,kind,name,phone,passport,identity,\"pricePaisa\",quantity,username)\n        SELECT id,'cashier',display_name,'','','',0,0,username FROM local_users WHERE role='cashier' ON CONFLICT DO NOTHING"));
            (await this.db.exec("INSERT INTO development_records(id,kind,name,phone,passport,identity,\"pricePaisa\",quantity,username)\n        SELECT id,'admin',display_name,'','','',0,0,username FROM local_users WHERE role='admin' AND is_superuser=0 ON CONFLICT DO NOTHING"));
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
        (await this.installRestaurantMenu());
    }
    async installRestaurantMenu() {
        if (!this.enabled)
            return;
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            (await this.db.prepare("UPDATE development_records SET archived=1 WHERE kind='menu' AND id IN ('sample-menu-1','sample-menu-2','sample-menu-3')").run());
            const insert = this.db.prepare("INSERT INTO development_records(id,kind,name,phone,passport,identity,\"pricePaisa\",quantity) VALUES(?,'menu',?,'','','',?,0) ON CONFLICT DO NOTHING");
            for (const [name, price] of restaurantMenu)
                (await insert.run(`khayber-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, price));
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
    }
    async list(role: unknown, category: unknown, query: unknown): Promise<ManagementRecord[]> {
        (await this.authorize(role, category));
        const type = kind(category), search = text(query, 120);
        if (type === 'floor')
            return (await this.db.prepare("SELECT id,kind,name,floor_tables FROM development_records WHERE kind='floor' AND archived=0 ORDER BY rowid").all()).filter(row => String(row.name).toLowerCase().includes(search.toLowerCase())).map(row => ({ id: String(row.id), kind: 'floor', name: String(row.name), phone: '', passport: '', identity: '', pricePaisa: 0, quantity: 0, tables: JSON.parse(String(row.floor_tables)) as number[] }));
        const columns = 'r.id,r.kind,r.name,r.phone,r.passport,r.identity,r."pricePaisa",r.quantity,r.username,r.shop_id AS "shopId",r.manage_finance AS "manageCreditsExpenses",r.image,r.payment_category AS "paymentCategory",r.employee,r.employee_id AS "employeeId",r.employee_category AS "employeeCategory",r.expense_type AS "expenseType",r.start_month AS "startMonth"';
        const actor = typeof role === 'object' && role ? role as LocalUser : null;
        if (type === 'shop' && actor?.role === 'cashier') {
            return (await this.db.prepare(`SELECT ${columns} FROM development_records r JOIN development_records c ON c.shop_id=r.id WHERE c.id=? AND r.kind='shop' AND r.archived=0`).all(actor.id)) as unknown as ManagementRecord[];
        }
        if (type === 'menu' && search) {
            const tokens = search.match(/[\p{L}\p{N}]+/gu);
            if (!tokens)
                return [];
            const match = tokens.map(token => `${token}:*`).join(' & ');
            return (await this.db.prepare(`SELECT ${columns} FROM development_records r CROSS JOIN (SELECT to_tsquery('simple', ?) AS query) search WHERE r.menu_search @@ search.query AND r.kind=? AND r.archived=0 ORDER BY ts_rank(r.menu_search,search.query) DESC,r.name`).all(match, type)) as unknown as ManagementRecord[];
        }
        const rows = (await this.db.prepare(`SELECT ${columns} FROM development_records r WHERE kind=? AND archived=0 AND (strpos(lower(name),lower(?))>0 OR strpos(phone,?)>0 OR strpos(lower(identity),lower(?))>0) ORDER BY lower(name),id`).all(type, search, search, search)) as unknown as ManagementRecord[];
        if (type !== 'recurring')
            return rows;
        const salaries = (await this.list(role, 'employee', '')).map(row => ({
            id: row.id, kind: 'recurring' as const, name: `Salary: ${row.name}`, phone: '', passport: '', identity: '',
            pricePaisa: row.pricePaisa, quantity: 0, shopId: row.shopId, employee: row.name, employeeId: row.id,
            employeeCategory: row.employeeCategory, expenseType: 'Salary', startMonth: row.startMonth,
        })).filter(row => row.name.toLowerCase().includes(search.toLowerCase()));
        return [...(await Promise.all(rows.map(async (row) => {
                const employee = row.employeeId ? (await this.db.prepare("SELECT name,kind,employee_category FROM development_records WHERE id=? AND kind IN ('employee','cashier')").get(row.employeeId)) : undefined;
                return employee ? { ...row, employee: String(employee.name), employeeCategory: employee.kind === 'cashier' ? 'Cashier' : String(employee.employee_category) } : row;
            }))), ...salaries].sort((a, b) => a.name.localeCompare(b.name));
    }
    async save(role: unknown, value: unknown, verifier?: Buffer) {
        if (!value || typeof value !== 'object')
            throw new Error('Invalid record.');
        const r = value as ManagementRecord;
        (await this.authorize(role, r.kind, true));
        const type = kind(r.kind), id = text(r.id, 64), name = text(r.name, 120, true);
        const username = (type === 'cashier' || type === 'admin') && r.username ? text(r.username, 64, true) : undefined;
        if (username && !/^[a-zA-Z0-9_.-]{3,64}$/.test(username))
            throw new Error('Invalid username.');
        const phone = text(r.phone, 30, ['cashier', 'creditor', 'admin'].includes(type)), passport = text(r.passport, 40), identity = text(r.identity, 64);
        if ((type === 'cashier' || type === 'creditor' || phone) && !/^[+\d ()-]{5,30}$/.test(phone))
            throw new Error('Enter a valid phone number.');
        const shopId = ['cashier', 'menu', 'recurring', 'employee'].includes(type) ? text(r.shopId, 64, true) : '';
        if (typeof (r.image ?? '') !== 'string' || (r.image?.length ?? 0) > 2700000)
            throw new Error('Choose a PNG, JPEG or WebP image up to 2 MB.');
        const image = text(r.image ?? '', 2700000);
        if (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
            throw new Error('Use a PNG, JPEG or WebP image up to 2 MB.');
        if (image) {
            const bytes = Buffer.from(image.split(',')[1], 'base64');
            const valid = image.startsWith('data:image/png;') ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
                : image.startsWith('data:image/jpeg;') ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
                    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
            if (!valid || bytes.length > 2000000)
                throw new Error('Invalid image or image larger than 2 MB.');
        }
        if (r.manageCreditsExpenses !== undefined && ![true, false, 0, 1].includes(r.manageCreditsExpenses))
            throw new Error('Invalid permission.');
        const paymentCategory = r.paymentCategory ?? 'cash';
        if (type === 'payment' && !['cash', 'card', 'online'].includes(paymentCategory))
            throw new Error('Choose a payment category.');
        let employeeCategory = text(r.employeeCategory ?? '', 80, type === 'employee');
        let employee = text(r.employee ?? '', 120);
        const employeeId = type === 'recurring' ? text(r.employeeId ?? '', 64) : '';
        const expenseType = text(r.expenseType ?? '', 80), startMonth = text(r.startMonth ?? '', 7);
        if (type === 'employee' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth))
            throw new Error('Choose a valid salary starting month.');
        if (type === 'recurring' && (!expenseType || (/^salar(y|ies)$/i.test(expenseType) && !employeeId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)))
            throw new Error('Choose a registered employee for salaries, an expense category, and starting month.');
        if (type === 'admin' && !username)
            throw new Error('Username required.');
        if (!Number.isSafeInteger(r.pricePaisa) || r.pricePaisa < 0 || r.pricePaisa > 999999999 || (['menu', 'recurring', 'employee'].includes(type) && r.pricePaisa === 0))
            throw new Error('Enter a positive price with at most two decimals.');
        if (!Number.isSafeInteger(r.quantity) || r.quantity < 0 || r.quantity > 999999999)
            throw new Error('Stock quantity must be a non-negative whole number.');
        const recordId = id || randomUUID();
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            if (['cashier', 'menu', 'recurring', 'employee'].includes(type) && !(type === 'menu' && shopId === '__all__') && !(await this.db.prepare("SELECT id FROM development_records WHERE id=? AND kind='shop' AND archived=0").get(shopId)))
                throw new Error('Choose an active shop.');
            if (type === 'recurring') {
                if (employee && !employeeId)
                    throw new Error('Choose a registered employee from the employee picker.');
                if (employeeId) {
                    const selected = (await this.db.prepare("SELECT id,name,kind,shop_id,employee_category FROM development_records WHERE id=? AND kind IN ('employee','cashier') AND archived=0").get(employeeId));
                    if (!selected)
                        throw new Error('Choose an active registered employee.');
                    if (selected.shop_id !== shopId)
                        throw new Error('Choose an employee assigned to this shop.');
                    employee = String(selected.name);
                    employeeCategory = selected.kind === 'cashier' ? 'Cashier' : String(selected.employee_category);
                    if (/^salar(y|ies)$/i.test(expenseType)) {
                        if (selected.kind === 'employee') {
                            if (id && id !== employeeId) {
                                const retired = (await this.db.prepare("UPDATE development_records SET archived=1 WHERE id=? AND kind='recurring' AND archived=0").run(id));
                                if (!retired.changes)
                                    throw new Error('Record no longer available. Refresh the list.');
                                for (const snapshot of (await this.db.prepare("SELECT month,payload FROM recurring_payments WHERE id=? AND lower((payload::jsonb #>> '{expenseType}')) IN ('salary','salaries')").all(id))) {
                                    if ((await this.db.prepare("SELECT id FROM recurring_payments WHERE month=? AND id<>? AND (id=? OR (payload::jsonb #>> '{employeeId}')=?) AND lower((payload::jsonb #>> '{expenseType}')) IN ('salary','salaries')").get(snapshot.month, id, employeeId, employeeId)))
                                        throw new Error('This employee already has another salary record for the same month. Keep the existing payment history separate instead of linking these entries.');
                                    (await this.db.prepare("UPDATE recurring_payments SET payload=? WHERE id=? AND month=?").run(JSON.stringify({ ...JSON.parse(String(snapshot.payload)), employeeId }), id, snapshot.month));
                                }
                            }
                            // Employee salary and recurring salary editing share one source and monthly payment ID.
                            (await this.db.prepare("UPDATE development_records SET \"pricePaisa\"=?,start_month=? WHERE id=? AND kind='employee' AND archived=0").run(r.pricePaisa, startMonth, employeeId));
                            (await this.db.exec("COMMIT"));
                            return;
                        }
                        if ((await this.db.prepare("SELECT id FROM development_records WHERE kind='recurring' AND archived=0 AND employee_id=? AND lower(expense_type) IN ('salary','salaries') AND id<>?").get(employeeId, id)))
                            throw new Error('This employee already has a salary entry. Update that entry instead.');
                    }
                }
            }
            if (type === 'floor') {
                if (!Array.isArray(r.tables) || r.tables.length > 500 || r.tables.some(n => !Number.isSafeInteger(n) || n < 1 || n > 9999) || new Set(r.tables).size !== r.tables.length)
                    throw new Error('Use unique table numbers from 1 to 9999, up to 500 tables per floor.');
                if ((await this.db.prepare("SELECT id FROM development_records WHERE kind='floor' AND lower(name)=lower(?) AND archived=0 AND id<>?").get(name, recordId)))
                    throw new Error('A floor with this name already exists.');
            }
            if (type === 'employee-category' || type === 'expense-category') {
                text(name, 80, true);
                if (id)
                    throw new Error('Categories cannot be renamed. Add a new category.');
                if ((await this.db.prepare("SELECT id FROM development_records WHERE kind=? AND lower(name)=lower(?) AND archived=0").get(type, name)))
                    throw new Error('This category already exists.');
            }
            if (type === 'employee' && !(await this.db.prepare("SELECT id FROM development_records WHERE kind='employee-category' AND name=? AND archived=0").get(employeeCategory)))
                throw new Error('Choose an employee category.');
            if (username && (await this.db.prepare("SELECT id FROM local_users WHERE lower(username)=lower(?) AND id <> ?").get(username, recordId))) {
                throw new Error('This username is already in use. Choose another username.');
            }
            if (id) {
                const result = (await this.db.prepare("UPDATE development_records SET name=?,phone=?,passport=?,identity=?,\"pricePaisa\"=?,quantity=? WHERE id=? AND kind=? AND archived=0").run(name, phone, passport, identity, r.pricePaisa, r.quantity, id, type));
                if (!result.changes)
                    throw new Error('Record no longer available. Refresh the list.');
            }
            else {
                (await this.db.prepare("INSERT INTO development_records(id,kind,name,phone,passport,identity,\"pricePaisa\",quantity) VALUES(?,?,?,?,?,?,?,?)").run(recordId, type, name, phone, passport, identity, r.pricePaisa, r.quantity));
            }
            (await this.db.prepare("UPDATE development_records SET shop_id=?,manage_finance=?,image=?,payment_category=?,employee=?,expense_type=?,start_month=?,employee_category=?,employee_id=? WHERE id=?")
                .run(shopId, r.manageCreditsExpenses ? 1 : 0, type === 'menu' ? image : '', paymentCategory, employee, expenseType, startMonth, employeeCategory, employeeId, recordId));
            if (type === 'floor')
                (await this.db.prepare("UPDATE development_records SET floor_tables=? WHERE id=?").run(JSON.stringify(r.tables!.slice().sort((a, b) => a - b)), recordId));
            if (username) {
                (await this.db.prepare("UPDATE development_records SET username=? WHERE id=?").run(username, recordId));
                const existing = (await this.db.prepare("SELECT id FROM local_users WHERE id=?").get(recordId));
                if (existing) {
                    (await this.db.prepare("UPDATE local_users SET username=?,display_name=?,is_demo=CASE WHEN ?=1 THEN 0 ELSE is_demo END WHERE id=? AND is_superuser=0 AND (is_demo=1 OR ?=1)").run(username, name, this.provisioned ? 1 : 0, recordId, this.provisioned ? 1 : 0));
                    if (verifier)
                        (await this.db.prepare("UPDATE local_users SET verifier=?,failed_attempts=0,blocked_until=0 WHERE id=? AND is_superuser=0 AND (is_demo=1 OR ?=1)").run(verifier, recordId, this.provisioned ? 1 : 0));
                }
                else {
                    if (!verifier)
                        throw new Error('A password is required for a new cashier account.');
                    (await this.db.prepare("INSERT INTO local_users(id,username,display_name,verifier,is_demo,role) VALUES(?,?,?,?,?,?)").run(recordId, username, name, verifier, this.provisioned ? 0 : 1, type === 'admin' ? 'admin' : 'cashier'));
                }
            }
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
    }
    async remove(role: unknown, category: unknown, recordId: unknown) {
        (await this.authorize(role, category, true));
        if (category === 'recurring' && (await this.db.prepare("SELECT id FROM development_records WHERE id=? AND kind='employee' AND archived=0").get(text(recordId, 64, true))))
            throw new Error('Remove the employee from Manage Employees to stop their salary. Existing monthly history is retained.');
        if (category === 'employee-category' || category === 'expense-category')
            throw new Error('Categories cannot be removed.');
        if (category === 'shop') {
            const id = text(recordId, 64, true);
            if ((await this.db.prepare("SELECT id FROM development_records WHERE kind IN ('cashier','menu','recurring','employee') AND shop_id=? AND archived=0").get(id)))
                throw new Error('Reassign or remove this shop’s cashiers, employees, menu items and recurring expenses first.');
            for (const table of ['sales', 'expenses', 'repayments', 'recurring_payments']) {
                if ((await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?").get(table)) && (await this.db.prepare(`SELECT id FROM ${table} WHERE shop_id=? LIMIT 1`).get(id)))
                    throw new Error('Shops with financial records must remain available for reporting.');
            }
        }
        if (category === 'creditor' && (await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='customer_credit_entries'").get())) {
            const id = text(recordId, 64, true);
            const credit = Number((await this.db.prepare("SELECT COALESCE(SUM(amount_minor),0) amount FROM customer_credit_entries WHERE customer_id=?").get(id))!.amount);
            const recovered = (await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='repayments'").get()) ? Number((await this.db.prepare("SELECT COALESCE(SUM(amount_minor),0) amount FROM repayments WHERE customer_id=?").get(id))!.amount) : 0;
            if (credit > recovered)
                throw new Error('Recover the outstanding balance before removing this creditor.');
            if ((await this.db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='repayments'").get()) && (await this.db.prepare("SELECT id FROM repayments WHERE customer_id=? AND recovery_ready=0").get(id)))
                throw new Error('Confirm the pending recovery backup before removing this creditor.');
        }
        const result = (await this.db.prepare("UPDATE development_records SET archived=1 WHERE kind=? AND id=? AND archived=0").run(kind(category), text(recordId, 64, true)));
        if (!result.changes)
            throw new Error('Record no longer available.');
    }
    async monthly(actor: unknown, value: unknown): Promise<MonthlyExpense[]> {
        (await this.authorize(actor));
        const month = text(value, 7, true);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            throw new Error('Choose a valid month.');
        for (const row of (await this.list(actor, 'recurring', '')).filter(row => row.startMonth! <= month)) {
            if (row.employeeId && /^salar(y|ies)$/i.test(row.expenseType || '') && (await this.db.prepare("SELECT id FROM recurring_payments WHERE month=? AND (payload::jsonb #>> '{employeeId}')=? AND lower((payload::jsonb #>> '{expenseType}')) IN ('salary','salaries')").get(month, row.employeeId)))
                continue;
            (await this.db.prepare("INSERT INTO recurring_payments VALUES(?,?,?,?) ON CONFLICT DO NOTHING").run(row.id, month, row.shopId!, JSON.stringify({ ...row, month, paid: false })));
        }
        return (await this.db.prepare("SELECT payload FROM recurring_payments WHERE month=?").all(month)).map(row => { const expense = JSON.parse(String(row.payload)) as MonthlyExpense; return { ...expense, paidMinor: expense.paidMinor ?? (expense.paid ? expense.pricePaisa : 0), payments: expense.payments ?? [] }; });
    }
    async recordPayment(actor: LocalUser, idValue: unknown, monthValue: unknown, amount: unknown, operationValue: unknown) {
        (await this.authorize(actor));
        const id = text(idValue, 64, true), month = text(monthValue, 7, true), operationId = text(operationValue, 64, true);
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0)
            throw new Error('Enter a positive payment with up to two decimals.');
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            const row = (await this.monthly(actor, month)).find(r => r.id === id);
            if (!row)
                throw new Error('Expense unavailable for this month.');
            const previous = row.payments.find(p => p.operationId === operationId);
            if (previous && previous.amountMinor !== amount)
                throw new Error('This payment reference has already been used for a different amount.');
            if (!previous) {
                if (amount > row.pricePaisa - row.paidMinor)
                    throw new Error('Payment cannot exceed the remaining amount. Refresh the monthly expenses and try again.');
                const paidMinor = row.paidMinor + amount, paidAt = new Date().toISOString(), paidBy = actor.displayName;
                (await this.db.prepare("UPDATE recurring_payments SET payload=? WHERE id=? AND month=?").run(JSON.stringify({ ...row, paidMinor, paid: paidMinor === row.pricePaisa, paidAt, paidBy, payments: [...row.payments, { operationId, amountMinor: amount, paidAt, paidBy }] }), id, month));
            }
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
    }
    async setPaid(actor: LocalUser, idValue: unknown, monthValue: unknown, paid: unknown) {
        (await this.authorize(actor));
        if (typeof paid !== 'boolean')
            throw new Error('Invalid payment status.');
        const id = text(idValue, 64, true), month = text(monthValue, 7, true);
        (await this.db.exec("BEGIN IMMEDIATE"));
        try {
            const row = (await this.monthly(actor, month)).find(r => r.id === id);
            if (!row)
                throw new Error('Expense unavailable for this month.');
            if (row.payments.length)
                throw new Error('Recorded payments cannot be cleared. Record the remaining payment instead.');
            if (paid !== row.paid)
                (await this.db.prepare("UPDATE recurring_payments SET payload=? WHERE id=? AND month=?").run(JSON.stringify({ ...row, paid, paidMinor: paid ? row.pricePaisa : 0, paidAt: paid ? new Date().toISOString() : undefined, paidBy: paid ? actor.displayName : undefined }), id, month));
            (await this.db.exec("COMMIT"));
        }
        catch (error) {
            (await this.db.exec("ROLLBACK"));
            throw error;
        }
    }
    async close() { this.db.close(); }
}
