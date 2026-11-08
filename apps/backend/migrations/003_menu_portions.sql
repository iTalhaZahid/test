ALTER TABLE pos_web.development_records ADD COLUMN half_price integer NOT NULL DEFAULT 0;
ALTER TABLE pos_web.development_records ADD CONSTRAINT menu_portion_prices CHECK (
  half_price>=0 AND (half_price=0 OR (kind='menu' AND half_price<="pricePaisa"))
);
CREATE TABLE pos_web.catalog_versions(name text PRIMARY KEY, version text NOT NULL);
