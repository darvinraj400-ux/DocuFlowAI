-- ===========================================================================
-- DocuFlow AI — grant DML to service_role for server-side admin writes
--
-- The SSR admin client (service-role key) performs business-critical writes
-- from authenticated server-side routes (upload-intent, process, fail, review).
-- The 00001 migration only granted SELECT to `authenticated`; it never granted
-- service_role any privileges, so admin inserts fail with SQLSTATE 42501
-- ("permission denied for table invoices"). This restores the intended write
-- path. RLS stays enabled; service_role bypasses RLS by design and the
-- application code still enforces ownership (user_id scoping) on every write.
-- ===========================================================================

grant select, insert, update, delete on table public.invoices to service_role;
grant select, insert, update, delete on table public.invoice_line_items to service_role;
grant select, insert, update, delete on table public.invoice_events to service_role;
