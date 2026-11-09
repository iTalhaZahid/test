SET LOCAL search_path TO pos_web;
CREATE OR REPLACE FUNCTION desktop_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pos_web AS $$
DECLARE entity text := TG_ARGV[0]; item_key text; item_payload jsonb;
BEGIN
  IF entity='user' THEN
    item_key := NEW.id;
    item_payload := jsonb_build_object('id',NEW.id,'username',NEW.username,'displayName',NEW.display_name,
      'role',CASE WHEN NEW.is_superuser=1 THEN 'superuser' WHEN NEW.role='admin' THEN 'admin' ELSE 'cashier' END,
      'shopId',COALESCE((SELECT shop_id FROM development_records WHERE id=NEW.id),'main-shop'),
      'manageCreditsExpenses',COALESCE((SELECT manage_finance=1 FROM development_records WHERE id=NEW.id),false),
      'archived',COALESCE((SELECT archived=1 FROM development_records WHERE id=NEW.id),false));
  ELSE
    item_key := NEW.id;
    IF entity='recurring' THEN item_key := NEW.id||':'||NEW.month; END IF;
    item_payload := to_jsonb(NEW)-'rowid'-'menu_search';
  END IF;
  INSERT INTO desktop_changes(entity,key,payload) VALUES(entity,item_key,item_payload::text);
  RETURN NEW;
END $$;
-- Refresh sanitized account metadata, including accounts already archived before sync was installed.
INSERT INTO desktop_changes(entity,key,payload)
SELECT 'user',u.id,jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,
  'role',CASE WHEN u.is_superuser=1 THEN 'superuser' WHEN u.role='admin' THEN 'admin' ELSE 'cashier' END,
  'shopId',COALESCE(r.shop_id,'main-shop'),'manageCreditsExpenses',COALESCE(r.manage_finance=1,false),'archived',COALESCE(r.archived=1,false))::text
FROM local_users u LEFT JOIN development_records r ON r.id=u.id;
