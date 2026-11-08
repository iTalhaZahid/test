import { discountAmount, menuPortionPrice } from '../../../desktop/src/main/sales-contract';
import type { MonthlyExpense } from '../../../desktop/src/main/management-contract';
import { PgDatabase } from './database.js';
import type { LocalUser } from '../../../desktop/src/main/auth-contract';
import type { Creditor, MenuItem, Sale, SaleFilter, SaleRequest, Expense, ExpenseRequest, Repayment, RepaymentRequest, CreditorAccount } from '../../../desktop/src/main/sales-contract';
function string(value: unknown, limit = 120) {
    if (typeof value !== 'string' || value.length > limit)
        throw new Error('Invalid text input.');
    return value.trim();
}
function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new Error('Invalid amount or quantity.');
    return value;
}
export function businessDate(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}
export class SalesStore {
    private db: PgDatabase;
    constructor(db: PgDatabase, private protect: (payload: string) => Uint8Array) { this.db = db; }
    private async readSale(row: Record<string, unknown>): Promise<Sale> {
        return { ...JSON.parse(String(row.payload)), invoiceNumber: Number(row.invoice_number) } as Sale;
    }
    private async cashierShop(user: LocalUser) {
        const shop = (await this.db.prepare("SELECT s.id,s.name FROM development_records c\n      JOIN development_records s ON s.id=c.shop_id AND s.kind='shop' AND s.archived=0\n      WHERE c.id=? AND c.kind='cashier' AND c.archived=0").get(user.id));
        if (!shop)
            throw new Error('Ask an administrator to assign this cashier to an active shop.');
        return { shopId: String(shop.id), shopName: String(shop.name) };
    }
    private async authorize(user: LocalUser | null) {
        if (!user || !['superuser', 'admin', 'cashier'].includes(user.role))
            throw new Error('Sign in to continue.');
        if ((await this.db.prepare("SELECT id FROM development_records WHERE id=? AND archived=1").get(user.id)))
            throw new Error('This account is inactive.');
        return user;
    }
    private async finance(user: LocalUser | null) {
        const actor = (await this.authorize(user));
        if (actor.role === 'cashier' && !(await this.db.prepare("SELECT id FROM development_records WHERE id=? AND archived=0 AND manage_finance=1").get(actor.id)))
            throw new Error('Manage Credits and Expense permission required.');
        return actor;
    }
    async paymentMethods(user: LocalUser | null) {
        (await this.authorize(user));
        return (await this.db.prepare("SELECT id,name,payment_category AS category FROM development_records WHERE kind='payment' AND archived=0 ORDER BY payment_category,name").all()) as unknown as import('../../../desktop/src/main/sales-contract').PaymentMethod[];
    }
    async menu(user: LocalUser | null, query: unknown): Promise<MenuItem[]> {
        const actor = (await this.authorize(user)), search = string(query);
        const tokens = search.match(/[\p{L}\p{N}]+/gu);
        if (search && !tokens)
            return [];
        const shopId = actor.role === 'cashier' ? (await this.cashierShop(actor)).shopId : '';
        const match = tokens?.map(token => `${token}:*`).join(' & ');
        const rows = (await this.db.prepare(`SELECT r.id,r.name,r.image,r."pricePaisa" AS "priceMinor",r.half_price AS "halfPriceMinor",
      EXISTS(SELECT 1 FROM menu_favourites f WHERE f.item_id=r.id AND f.cashier_id=?) AS favourite
      FROM development_records r
      WHERE r.kind='menu' AND r.archived=0 AND (?='' OR r.shop_id=? OR r.shop_id='__all__') ${search ? "AND r.menu_search @@ to_tsquery('simple', ?)" : ''} ORDER BY lower(r.name)`)
            .all(...(search ? [actor.id, shopId, shopId, match!] : [actor.id, shopId, shopId])));
        return rows.map(row => ({ id: String(row.id), name: String(row.name), priceMinor: Number(row.priceMinor), halfPriceMinor: Number(row.halfPriceMinor)||undefined, favourite: !!row.favourite, image: String(row.image) }));
    }
    async favourite(user: LocalUser | null, itemId: unknown, enabled: unknown) {
        const actor = (await this.authorize(user)), id = string(itemId, 64);
        if (actor.role === 'cashier' && !(await this.db.prepare("SELECT id FROM development_records WHERE id=? AND (shop_id=? OR shop_id='__all__')").get(id, (await this.cashierShop(actor)).shopId)))
            throw new Error('Menu item belongs to another shop.');
        if (typeof enabled !== 'boolean' || !(await this.db.prepare("SELECT id FROM development_records WHERE id=? AND kind='menu' AND archived=0").get(id)))
            throw new Error('Menu item unavailable.');
        if (enabled)
            (await this.db.prepare("INSERT INTO menu_favourites VALUES(?,?) ON CONFLICT DO NOTHING").run(actor.id, id));
        else
            (await this.db.prepare("DELETE FROM menu_favourites WHERE cashier_id=? AND item_id=?").run(actor.id, id));
    }
    async creditors(user: LocalUser | null, query: unknown): Promise<Creditor[]> {
        (await this.finance(user));
        const search = string(query);
        return (await this.db.prepare("SELECT id,name,phone FROM development_records WHERE kind='creditor' AND archived=0 AND (strpos(lower(name),lower(?))>0 OR strpos(phone,?)>0) ORDER BY lower(name)").all(search, search)) as unknown as Creditor[];
    }
    private async recovery(sale: Sale | Expense | Repayment) {
        const table = 'acceptedBy' in sale ? 'repayments' : 'paidVia' in sale ? 'expenses' : 'sales';
            (await this.db.prepare("INSERT INTO recovery_entries(operation_id,kind,payload) VALUES(?,?,?) ON CONFLICT(kind,operation_id) DO UPDATE SET payload=excluded.payload").run(sale.id, table, (await this.protect(JSON.stringify(sale)))));
        (await this.db.prepare(`UPDATE ${table} SET recovery_ready=1 WHERE id=?`).run(sale.id));
    }
    async save(user: LocalUser | null, input: unknown): Promise<{
        ok: true;
        sale: Sale;
    } | {
        ok: false;
        pending: boolean;
        message: string;
    }> {
        let committed = false;
        try {
            const actor = (await this.authorize(user));
            if (!input || typeof input !== 'object')
                throw new Error('Invalid order.');
            const request = input as SaleRequest;
            const id = string(request.operationId, 64);
            if (!/^[a-f0-9-]{36}$/i.test(id))
                throw new Error('Invalid order ID.');
            const original = (await this.db.prepare("SELECT * FROM sales WHERE id=?").get(id));
            if (original) {
                if (original.cashier_id !== actor.id || original.request !== JSON.stringify(request))
                    throw new Error('This order ID belongs to a different order.');
                committed = true;
                const sale = (await this.readSale(original));
                (await this.recovery(sale));
                return { ok: true, sale };
            }
            if (request.customerType === 'creditor')
                (await this.finance(actor));
            const paymentMethod = (await this.paymentMethods(actor)).find(method => method.id === (request.paymentMethodId ?? 'payment-cash'));
            if (!paymentMethod)
                throw new Error('Choose an active payment method.');
            if (!['walk-in', 'creditor', 'delivery'].includes(request.customerType))
                throw new Error("Select a customer type.");
            if (!Array.isArray(request.lines) || request.lines.length < 1 || request.lines.length > 200)
                throw new Error('Add between 1 and 200 items.');
            const received = integer(request.receivedMinor, 0, 99999999999);
            (await this.db.exec("BEGIN IMMEDIATE"));
            let sale: Sale;
            try {
                const shop = (await this.cashierShop(actor));
                let creditor: Creditor | null = null;
                if (request.customerType === 'creditor') {
                    creditor = (await this.db.prepare("SELECT id,name,phone FROM development_records WHERE id=? AND kind='creditor' AND archived=0").get(string(request.creditorId, 64))) as unknown as Creditor;
                    if (!creditor)
                        throw new Error("Select an active creditor.");
                }
                else if (request.creditorId !== null)
                    throw new Error('Customer type does not match creditor.');
                let table: Sale['table'];
                if (request.table !== undefined) {
                    if (!request.table || typeof request.table !== 'object')
                        throw new Error('Choose a valid table.');
                    const floorId = string(request.table.floorId, 64), number = integer(request.table.number, 1, 9999);
                    const floor = (await this.db.prepare("SELECT name,floor_tables FROM development_records WHERE id=? AND kind='floor' AND archived=0").get(floorId));
                    if (!floor || !(JSON.parse(String(floor.floor_tables)) as number[]).includes(number))
                        throw new Error('This table is no longer available. Choose another table.');
                    const floorName = String(floor.name);
                    table = { floorId, floorName, number, label: `${floorName.charAt(0).toUpperCase()}${number}` };
                }
                const seen = new Set<string>();
                const lines = (await Promise.all(request.lines.map(async (line) => {
                    if (!line || typeof line !== 'object')
                        throw new Error('Invalid item.');
                    const itemId = string(line.itemId, 64), quantity = integer(line.quantity, 1, 9999);
                    const lineKey = `${itemId}:${line.portion || "regular"}`;
                    if (seen.has(lineKey))
                        throw new Error('Duplicate item.');
                    seen.add(lineKey);
                    const item = (await this.db.prepare("SELECT name,\"pricePaisa\",half_price FROM development_records WHERE id=? AND kind='menu' AND archived=0 AND (shop_id=? OR shop_id='__all__')").get(itemId, shop.shopId));
                    if (!item)
                        throw new Error('An item is no longer available. Remove it and try again.');
                    const unitPrice = integer(menuPortionPrice(Number(item.pricePaisa),Number(item.half_price),line.portion), 1, 999999999);
                    if (line.unitPrice !== unitPrice)
                        throw new Error('A price changed. Remove and re-add the item before saving.');
                    return { itemId, name: String(item.name)+(line.portion?` (${line.portion==='half'?'Half':'Full'})`: ''), ...(line.portion?{portion:line.portion}:{}), quantity, unitPrice, total: unitPrice * quantity };
                })));
                const subtotal = integer(lines.reduce((sum, line) => sum + line.total, 0), 1, 99999999999);
                const discountMinor = discountAmount(subtotal, request.discount), total = subtotal - discountMinor;
                if (!creditor && received < total)
                    throw new Error('Amount received must cover the total bill.');
                if (paymentMethod.category !== 'cash' && received > total)
                    throw new Error('Card and online payments cannot exceed the total bill.');
                const date = new Date();
                const invoiceNumber = Number((await this.db.prepare("SELECT COALESCE(MAX(invoice_number),1000)+1 AS next FROM sales").get())!.next);
                if (invoiceNumber > 99999999)
                    throw new Error('Eight-digit invoice numbers are exhausted. Contact support.');
                sale = { id, invoiceNumber, date: date.toISOString(), businessDate: businessDate(date), currency: 'QAR', cashierId: actor.id, cashierName: actor.displayName, ...shop,
                    customerType: request.customerType, ...(table ? { table } : {}), paymentMethod, creditor, lines, subtotal, discountMinor, ...(request.discount ? { discount: request.discount } : {}), total, received, cashApplied: Math.min(received, total), change: Math.max(0, received - total), credit: Math.max(0, total - received) };
                const payload = JSON.stringify(sale);
                (await this.db.prepare("INSERT INTO sales(id,cashier_id,business_date,customer_type,request,payload,shop_id,invoice_number) VALUES(?,?,?,?,?,?,?,?)").run(id, actor.id, sale.businessDate, sale.customerType, JSON.stringify(request), payload, sale.shopId!, invoiceNumber));
                (await this.db.prepare("INSERT INTO sale_outbox(operation_id,payload) VALUES(?,?)").run(id, payload));
                if (creditor)
                    (await this.db.prepare("INSERT INTO customer_credit_entries VALUES(?,?,?,?,?)").run(id, creditor.id, sale.date, actor.id, sale.credit));
                (await this.db.exec("COMMIT"));
                committed = true;
            }
            catch (error) {
                (await this.db.exec("ROLLBACK"));
                throw error;
            }
            (await this.recovery(sale));
            return { ok: true, sale };
        }
        catch (error) {
            return { ok: false, pending: committed, message: committed ? 'Recovery copy could not be confirmed. Keep this order and retry Save Order; do not enter it again.' : error instanceof Error ? error.message : 'Unable to save order.' };
        }
    }
    async history(user: LocalUser | null, input: unknown): Promise<Sale[]> {
        const actor = (await this.finance(user));
        if (!input || typeof input !== 'object')
            throw new Error('Invalid filter.');
        const filter = input as SaleFilter;
        const start = string(filter.start, 10), end = string(filter.end, 10);
        const shopId = filter.shopId === undefined ? '' : string(filter.shopId, 64);
        if (actor.role === 'cashier' && shopId !== (await this.cashierShop(actor)).shopId)
            throw new Error('Choose your assigned shop.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || !['all', 'cash', 'creditor'].includes(filter.type))
            throw new Error('Choose a valid date range.');
        return (await Promise.all((await this.db.prepare(`SELECT payload,invoice_number FROM sales WHERE business_date BETWEEN ? AND ? ${shopId ? 'AND shop_id=?' : ''} ${filter.type === 'cash' ? "AND customer_type!='creditor' AND COALESCE((payload::jsonb #>> '{paymentMethod,category}'),'cash')='cash'" : filter.type === 'creditor' ? "AND customer_type='creditor'" : ''} ORDER BY rowid DESC`).all(...(shopId ? [start, end, shopId === '__legacy__' ? '' : shopId] : [start, end]))).map(async (row) => (await this.readSale(row)))));
    }
    async saveExpense(user: LocalUser | null, input: unknown): Promise<{
        ok: true;
        expense: Expense;
    } | {
        ok: false;
        pending: boolean;
        message: string;
    }> {
        let committed = false;
        try {
            const actor = (await this.authorize(user));
            if (!input || typeof input !== 'object')
                throw new Error('Invalid expense.');
            const request = input as ExpenseRequest;
            const id = string(request.operationId, 64);
            if (!/^[a-f0-9-]{36}$/i.test(id))
                throw new Error('Invalid expense ID.');
            const previous = (await this.db.prepare("SELECT * FROM expenses WHERE id=?").get(id));
            if (previous) {
                if (previous.cashier_id !== actor.id || previous.request !== JSON.stringify(request))
                    throw new Error('Expense ID already used.');
                committed = true;
                const expense = JSON.parse(String(previous.payload)) as Expense;
                (await this.recovery(expense));
                return { ok: true, expense };
            }
            const date = string(request.date, 10), category = string(request.category, 80), description = string(request.description, 500);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
                throw new Error('Choose a valid expense date.');
            if (!category || !description)
                throw new Error('Enter category and description.');
            if (!['cash', 'online'].includes(request.paidVia))
                throw new Error('Choose Cash or Online.');
            const amountMinor = integer(request.amountMinor, 1, 99999999999);
            let shop;
            if (actor.role === 'cashier')
                shop = (await this.cashierShop(actor));
            else {
                const selected = (await this.db.prepare("SELECT id,name FROM development_records WHERE id=? AND kind='shop' AND archived=0").get(string(request.shopId, 64)));
                if (!selected)
                    throw new Error('Choose an active shop for this expense.');
                shop = { shopId: String(selected.id), shopName: String(selected.name) };
            }
            const expense: Expense = { ...request, id, date, category, description, amountMinor, createdAt: new Date().toISOString(), cashierId: actor.id, cashierName: actor.displayName, currency: 'QAR', ...shop };
            const payload = JSON.stringify(expense);
            (await this.db.exec("BEGIN IMMEDIATE"));
            try {
                (await this.db.prepare("INSERT INTO expenses(id,cashier_id,date,request,payload,shop_id) VALUES(?,?,?,?,?,?)").run(id, actor.id, date, JSON.stringify(request), payload, expense.shopId!));
                (await this.db.prepare("INSERT INTO expense_outbox(operation_id,payload) VALUES(?,?)").run(id, payload));
                (await this.db.exec("COMMIT"));
                committed = true;
            }
            catch (error) {
                (await this.db.exec("ROLLBACK"));
                throw error;
            }
            (await this.recovery(expense));
            return { ok: true, expense };
        }
        catch (error) {
            return { ok: false, pending: committed, message: committed ? 'Recovery copy unconfirmed. Retry this expense; do not enter it again.' : error instanceof Error ? error.message : 'Unable to save expense.' };
        }
    }
    async expenses(user: LocalUser | null, startValue: unknown, endValue: unknown, shopValue: unknown = ''): Promise<Expense[]> {
        const actor = (await this.finance(user));
        const start = string(startValue, 10), end = string(endValue, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
            throw new Error('Invalid date range.');
        const shopId = string(shopValue, 64);
        if (actor.role === 'cashier' && shopId !== (await this.cashierShop(actor)).shopId)
            throw new Error('Choose your assigned shop.');
        const expenses = (await this.db.prepare(`SELECT payload FROM expenses WHERE date BETWEEN ? AND ? ${shopId ? 'AND shop_id=?' : ''} ORDER BY date DESC,rowid DESC`).all(...(shopId ? [start, end, shopId === '__legacy__' ? '' : shopId] : [start, end]))).map(row => JSON.parse(String(row.payload)) as Expense);
        const monthly = (await this.db.prepare(`SELECT p.payload,p.shop_id,s.name AS shop_name FROM recurring_payments p LEFT JOIN development_records s ON s.id=p.shop_id AND s.kind='shop' ${shopId ? 'WHERE p.shop_id=?' : ''}`).all(...(shopId ? [shopId === '__legacy__' ? '' : shopId] : [])));
        for (const entry of monthly) {
            const row = JSON.parse(String(entry.payload)) as MonthlyExpense;
            const payments = row.payments?.length ? row.payments : row.paid && row.paidAt ? [{ operationId: 'legacy', amountMinor: row.paidMinor ?? row.pricePaisa, paidAt: row.paidAt, paidBy: row.paidBy || 'Not recorded' }] : [];
            for (const payment of payments) {
                const date = businessDate(new Date(payment.paidAt));
                if (date < start || date > end)
                    continue;
                const id = `recurring:${row.id}:${row.month}:${payment.operationId}`;
                expenses.push({ id, operationId: id, date, category: row.expenseType || 'Recurring expense', description: `${row.name} (${row.month})`, amountMinor: payment.amountMinor, paidVia: 'Not recorded', createdAt: payment.paidAt, cashierId: '', cashierName: payment.paidBy, currency: 'QAR', shopId: String(entry.shop_id), shopName: entry.shop_name ? String(entry.shop_name) : undefined });
            }
        }
        return expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    }
    async creditorAccount(user: LocalUser | null, idValue: unknown): Promise<CreditorAccount> {
        (await this.finance(user));
        const id = string(idValue, 64);
        const creditor = (await this.db.prepare("SELECT id,name,phone FROM development_records WHERE id=? AND kind='creditor'").get(id)) as unknown as Creditor;
        if (!creditor)
            throw new Error('Creditor not found.');
        const sales = (await Promise.all((await this.db.prepare("SELECT s.payload,s.invoice_number FROM sales s JOIN customer_credit_entries c ON c.operation_id=s.id WHERE c.customer_id=? ORDER BY s.rowid DESC").all(id)).map(async (row) => (await this.readSale(row)))));
        const repayments = (await this.db.prepare("SELECT payload FROM repayments WHERE customer_id=? ORDER BY date DESC,rowid DESC").all(id)).map(row => JSON.parse(String(row.payload)) as Repayment);
        const credit = sales.reduce((sum, sale) => sum + sale.credit, 0), recovered = repayments.reduce((sum, payment) => sum + payment.amountMinor, 0);
        return { creditor, sales, repayments, credit, recovered, outstanding: credit - recovered };
    }
    async repayments(user: LocalUser | null, startValue: unknown, endValue: unknown, shopValue: unknown = ''): Promise<Repayment[]> {
        const actor = (await this.finance(user));
        const start = string(startValue, 10), end = string(endValue, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
            throw new Error('Invalid date range.');
        const shopId = string(shopValue, 64);
        if (actor.role === 'cashier' && shopId !== (await this.cashierShop(actor)).shopId)
            throw new Error('Choose your assigned shop.');
        return (await this.db.prepare(`SELECT payload FROM repayments WHERE date BETWEEN ? AND ? ${shopId ? 'AND shop_id=?' : ''} ORDER BY date DESC,rowid DESC`).all(...(shopId ? [start, end, shopId === '__legacy__' ? '' : shopId] : [start, end]))).map(row => JSON.parse(String(row.payload)) as Repayment);
    }
    async recoverCredit(user: LocalUser | null, input: unknown): Promise<{
        ok: true;
        repayment: Repayment;
    } | {
        ok: false;
        pending: boolean;
        message: string;
    }> {
        let committed = false;
        try {
            const actor = (await this.authorize(user));
            if (!input || typeof input !== 'object')
                throw new Error('Invalid recovery.');
            const request = input as RepaymentRequest, id = string(request.operationId, 64);
            if (!/^[a-f0-9-]{36}$/i.test(id))
                throw new Error('Invalid recovery ID.');
            const previous = (await this.db.prepare("SELECT * FROM repayments WHERE id=?").get(id));
            if (previous) {
                if (previous.accepted_by !== actor.id || previous.request !== JSON.stringify(request))
                    throw new Error('Recovery ID already used.');
                committed = true;
                const repayment = JSON.parse(String(previous.payload)) as Repayment;
                (await this.recovery(repayment));
                return { ok: true, repayment };
            }
            (await this.finance(actor));
            const creditorId = string(request.creditorId, 64), date = string(request.date, 10), amount = integer(request.amountMinor, 1, 99999999999);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > businessDate(new Date()))
                throw new Error('Choose a valid collection date, no later than today.');
            let repayment: Repayment;
            (await this.db.exec("BEGIN IMMEDIATE"));
            try {
                const account = (await this.creditorAccount(actor, creditorId));
                const shop = (await this.db.prepare("SELECT id,name FROM development_records WHERE id=? AND kind='shop' AND archived=0").get(string(request.shopId, 64)));
                if (!shop)
                    throw new Error('Choose an active collection shop.');
                if (actor.role === 'cashier' && shop.id !== (await this.cashierShop(actor)).shopId)
                    throw new Error('Collect payments at your assigned shop.');
                if (amount > account.outstanding)
                    throw new Error('Recovery cannot exceed the current outstanding balance.');
                repayment = { operationId: id, id, creditorId, date, amountMinor: amount, createdAt: new Date().toISOString(), acceptedBy: actor.id, acceptedByName: actor.displayName, creditor: account.creditor, currency: 'QAR', shopId: String(shop.id), shopName: String(shop.name) };
                const payload = JSON.stringify(repayment);
                (await this.db.prepare("INSERT INTO repayments(id,customer_id,accepted_by,date,amount_minor,request,payload,shop_id) VALUES(?,?,?,?,?,?,?,?)").run(id, creditorId, actor.id, date, amount, JSON.stringify(request), payload, repayment.shopId!));
                (await this.db.prepare("INSERT INTO repayment_outbox(operation_id,payload) VALUES(?,?)").run(id, payload));
                (await this.db.exec("COMMIT"));
                committed = true;
            }
            catch (error) {
                (await this.db.exec("ROLLBACK"));
                throw error;
            }
            (await this.recovery(repayment));
            return { ok: true, repayment };
        }
        catch (error) {
            return { ok: false, pending: committed, message: committed ? 'Recovery payment recorded but backup unconfirmed. Retry the same payment; do not collect it again.' : error instanceof Error ? error.message : 'Unable to save recovery.' };
        }
    }
    async close() { this.db.close(); }
}
