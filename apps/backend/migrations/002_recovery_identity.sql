ALTER TABLE pos_web.recovery_entries DROP CONSTRAINT recovery_entries_pkey;
ALTER TABLE pos_web.recovery_entries ADD PRIMARY KEY(kind,operation_id);
