SET LOCAL search_path TO pos_web;
CREATE TABLE desktop_devices(id text PRIMARY KEY,token_hash text NOT NULL UNIQUE,paired_by text NOT NULL REFERENCES local_users(id));
CREATE TABLE desktop_changes(version bigserial PRIMARY KEY,entity text NOT NULL,key text NOT NULL,payload text NOT NULL);
CREATE INDEX desktop_changes_key ON desktop_changes(entity,key,version DESC);
CREATE TABLE desktop_receipts(device_id text NOT NULL REFERENCES desktop_devices(id),entity text NOT NULL,key text NOT NULL,revision bigint NOT NULL,payload_hash text NOT NULL,version bigint NOT NULL,PRIMARY KEY(device_id,entity,key,revision));
CREATE SEQUENCE invoice_numbers MINVALUE 1001 MAXVALUE 99999999;
SELECT setval('invoice_numbers',GREATEST(COALESCE((SELECT MAX(invoice_number) FROM sales),1000)+1,1001),false);
CREATE TABLE desktop_invoice_ranges(device_id text NOT NULL REFERENCES desktop_devices(id),first_number integer NOT NULL,last_number integer NOT NULL,PRIMARY KEY(device_id,first_number));

CREATE FUNCTION desktop_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pos_web AS $$
DECLARE entity text := TG_ARGV[0]; item_key text; item_payload jsonb;
BEGIN
  IF entity='user' THEN
    item_key := NEW.id;
    item_payload := jsonb_build_object('id',NEW.id,'username',NEW.username,'displayName',NEW.display_name,
      'role',CASE WHEN NEW.is_superuser=1 THEN 'superuser' WHEN NEW.role='admin' THEN 'admin' ELSE 'cashier' END,
      'shopId',COALESCE((SELECT shop_id FROM development_records WHERE id=NEW.id),'main-shop'));
  ELSE
    item_key := NEW.id;
    IF entity='recurring' THEN item_key := NEW.id||':'||NEW.month; END IF;
    item_payload := to_jsonb(NEW)-'rowid'-'menu_search';
  END IF;
  INSERT INTO desktop_changes(entity,key,payload) VALUES(entity,item_key,item_payload::text);
  RETURN NEW;
END $$;
CREATE TRIGGER desktop_records AFTER INSERT OR UPDATE ON development_records FOR EACH ROW EXECUTE FUNCTION desktop_change('record');
CREATE TRIGGER desktop_recurring AFTER INSERT OR UPDATE ON recurring_payments FOR EACH ROW EXECUTE FUNCTION desktop_change('recurring');
CREATE TRIGGER desktop_sales AFTER INSERT OR UPDATE OF payload,invoice_number ON sales FOR EACH ROW EXECUTE FUNCTION desktop_change('sale');
CREATE TRIGGER desktop_expenses AFTER INSERT OR UPDATE OF payload ON expenses FOR EACH ROW EXECUTE FUNCTION desktop_change('expense');
CREATE TRIGGER desktop_repayments AFTER INSERT OR UPDATE OF payload ON repayments FOR EACH ROW EXECUTE FUNCTION desktop_change('repayment');
CREATE TRIGGER desktop_users AFTER INSERT OR UPDATE OF username,display_name,role,is_superuser,verifier ON local_users FOR EACH ROW EXECUTE FUNCTION desktop_change('user');
INSERT INTO desktop_changes(entity,key,payload) SELECT 'record',id,(to_jsonb(r)-'rowid'-'menu_search')::text FROM development_records r ORDER BY rowid;
INSERT INTO desktop_changes(entity,key,payload) SELECT 'user',u.id,jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,'role',CASE WHEN u.is_superuser=1 THEN 'superuser' WHEN u.role='admin' THEN 'admin' ELSE 'cashier' END,'shopId',COALESCE(r.shop_id,'main-shop'))::text FROM local_users u LEFT JOIN development_records r ON r.id=u.id;
INSERT INTO desktop_changes(entity,key,payload) SELECT 'recurring',id||':'||month,to_jsonb(r)::text FROM recurring_payments r;
INSERT INTO desktop_changes(entity,key,payload) SELECT 'sale',id,(to_jsonb(r)-'rowid')::text FROM sales r ORDER BY rowid;
INSERT INTO desktop_changes(entity,key,payload) SELECT 'expense',id,(to_jsonb(r)-'rowid')::text FROM expenses r ORDER BY rowid;
INSERT INTO desktop_changes(entity,key,payload) SELECT 'repayment',id,(to_jsonb(r)-'rowid')::text FROM repayments r ORDER BY rowid;
