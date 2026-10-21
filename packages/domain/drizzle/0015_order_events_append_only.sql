-- OrderEvent is the append-only audit trail; deletes stay allowed (they cascade from the Order).
CREATE FUNCTION order_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_events is append-only';
END $$;--> statement-breakpoint
CREATE TRIGGER order_events_no_update BEFORE UPDATE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION order_events_append_only();
