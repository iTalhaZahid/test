SET LOCAL search_path TO pos_web;
CREATE FUNCTION reserve_invoice_numbers(amount integer) RETURNS TABLE(first_number integer,last_number integer)
LANGUAGE plpgsql SET search_path=pos_web AS $$
DECLARE existing_number bigint; sequence_number bigint;
BEGIN
  IF amount<1 OR amount>10000 THEN RAISE EXCEPTION 'Invalid invoice allocation size'; END IF;
  PERFORM pg_advisory_xact_lock(71001);
  SELECT COALESCE(MAX(invoice_number),1000) INTO existing_number FROM sales;
  SELECT last_value INTO sequence_number FROM invoice_numbers;
  -- Existing website builds may have saved an invoice between migration and deployment.
  IF existing_number>=sequence_number THEN PERFORM setval('invoice_numbers',existing_number,true); END IF;
  RETURN QUERY SELECT MIN(n)::integer,MAX(n)::integer FROM (SELECT nextval('invoice_numbers') AS n FROM generate_series(1,amount)) numbers;
END $$;
