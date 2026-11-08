CREATE SCHEMA IF NOT EXISTS pos_sync;
CREATE SCHEMA IF NOT EXISTS pos_web;

SET LOCAL search_path TO pos_sync;
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, username text NOT NULL, display_name text NOT NULL,
 role text NOT NULL CHECK(role IN ('superuser','admin','cashier')), salt text NOT NULL, hash text NOT NULL,
 shop_id text NOT NULL, manage_finance integer NOT NULL DEFAULT 0,
 archived integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0, blocked_until bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(lower(username));
CREATE TABLE IF NOT EXISTS devices (id text PRIMARY KEY, token_hash text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS documents (entity text NOT NULL, key text NOT NULL, payload text NOT NULL, version bigint NOT NULL, PRIMARY KEY(entity,key));
CREATE TABLE IF NOT EXISTS changes (version bigserial PRIMARY KEY, entity text NOT NULL, key text NOT NULL, payload text NOT NULL);
CREATE TABLE IF NOT EXISTS events (device_id text NOT NULL, entity text NOT NULL, key text NOT NULL, payload text NOT NULL, rowid bigserial UNIQUE, PRIMARY KEY(device_id,entity,key));
CREATE TABLE IF NOT EXISTS sync_receipts (device_id text NOT NULL, entity text NOT NULL, key text NOT NULL, revision bigint NOT NULL, payload_hash text NOT NULL, version bigint NOT NULL, PRIMARY KEY(device_id,entity,key,revision));

SET LOCAL search_path TO pos_web;
CREATE TABLE IF NOT EXISTS local_users (
 id text PRIMARY KEY, username text NOT NULL, display_name text NOT NULL, verifier bytea NOT NULL,
 is_demo integer NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
 failed_attempts integer NOT NULL DEFAULT 0, blocked_until bigint NOT NULL DEFAULT 0,
 role text NOT NULL DEFAULT 'cashier' CHECK(role IN ('admin','cashier')),
 is_superuser integer NOT NULL DEFAULT 0 CHECK(is_superuser IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS local_users_username_unique ON local_users(lower(username));
CREATE TABLE IF NOT EXISTS development_records (
 id text PRIMARY KEY, kind text NOT NULL, name text NOT NULL, phone text NOT NULL,
 passport text NOT NULL, identity text NOT NULL, "pricePaisa" bigint NOT NULL CHECK("pricePaisa">=0),
 quantity integer NOT NULL CHECK(quantity>=0), archived integer NOT NULL DEFAULT 0,
 username text NOT NULL DEFAULT '', shop_id text NOT NULL DEFAULT 'main-shop', floor_tables text NOT NULL DEFAULT '[]',
 manage_finance integer NOT NULL DEFAULT 0, image text NOT NULL DEFAULT '', payment_category text NOT NULL DEFAULT 'cash',
 employee_id text NOT NULL DEFAULT '', employee_category text NOT NULL DEFAULT '', employee text NOT NULL DEFAULT '',
 expense_type text NOT NULL DEFAULT '', start_month text NOT NULL DEFAULT '', rowid bigserial UNIQUE,
 menu_search tsvector GENERATED ALWAYS AS (to_tsvector('simple',name)) STORED
);
CREATE INDEX IF NOT EXISTS menu_search_index ON development_records USING gin(menu_search);
CREATE TABLE IF NOT EXISTS recurring_payments (id text NOT NULL, month text NOT NULL, shop_id text NOT NULL, payload text NOT NULL, PRIMARY KEY(id,month));
CREATE TABLE IF NOT EXISTS sales (
 id text PRIMARY KEY, cashier_id text NOT NULL, business_date text NOT NULL, customer_type text NOT NULL,
 request text NOT NULL, payload text NOT NULL, recovery_ready integer NOT NULL DEFAULT 0,
 shop_id text NOT NULL DEFAULT '', invoice_number integer UNIQUE NOT NULL, rowid bigserial UNIQUE
);
CREATE TABLE IF NOT EXISTS sale_outbox (operation_id text PRIMARY KEY REFERENCES sales(id), payload text NOT NULL, state text NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS customer_credit_entries (
 operation_id text PRIMARY KEY REFERENCES sales(id), customer_id text NOT NULL, date text NOT NULL,
 cashier_id text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>=0)
);
CREATE TABLE IF NOT EXISTS menu_favourites (cashier_id text NOT NULL, item_id text NOT NULL, PRIMARY KEY(cashier_id,item_id));
CREATE TABLE IF NOT EXISTS expenses (
 id text PRIMARY KEY, cashier_id text NOT NULL, date text NOT NULL, request text NOT NULL, payload text NOT NULL,
 recovery_ready integer NOT NULL DEFAULT 0, shop_id text NOT NULL DEFAULT '', rowid bigserial UNIQUE
);
CREATE TABLE IF NOT EXISTS expense_outbox (operation_id text PRIMARY KEY REFERENCES expenses(id), payload text NOT NULL, state text NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS repayments (
 id text PRIMARY KEY, customer_id text NOT NULL, accepted_by text NOT NULL, date text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0), request text NOT NULL, payload text NOT NULL,
 recovery_ready integer NOT NULL DEFAULT 0, shop_id text NOT NULL DEFAULT '', rowid bigserial UNIQUE
);
CREATE TABLE IF NOT EXISTS repayment_outbox (operation_id text PRIMARY KEY REFERENCES repayments(id), payload text NOT NULL, state text NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS recovery_entries (operation_id text PRIMARY KEY, kind text NOT NULL, payload bytea NOT NULL);
CREATE TABLE IF NOT EXISTS web_sessions (token text PRIMARY KEY, user_id text NOT NULL REFERENCES local_users(id), expires bigint NOT NULL);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires);
CREATE INDEX IF NOT EXISTS sales_shop_date ON sales(shop_id,business_date);
CREATE INDEX IF NOT EXISTS expenses_shop_date ON expenses(shop_id,date);
CREATE INDEX IF NOT EXISTS repayments_shop_date ON repayments(shop_id,date);
CREATE INDEX IF NOT EXISTS creditor_sales ON customer_credit_entries(customer_id);
CREATE INDEX IF NOT EXISTS creditor_repayments ON repayments(customer_id);
