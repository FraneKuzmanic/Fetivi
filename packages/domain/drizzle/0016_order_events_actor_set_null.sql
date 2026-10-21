-- Deleting an account nulls its actor_id through the foreign key (an UPDATE): let exactly that through.
CREATE OR REPLACE FUNCTION order_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_id IS NULL AND to_jsonb(NEW) - 'actor_id' = to_jsonb(OLD) - 'actor_id' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_events is append-only';
END $$;
