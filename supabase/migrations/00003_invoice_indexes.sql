-- ===========================================================================
-- DocuFlow AI — forward-only migration: duplicate-search index corrections
-- ===========================================================================

-- The Phase 0 index referenced draft JSON keys (`supplier`, `invoiceNumber`).
-- Duplicate detection now uses normalized keys stored in `extracted_data`
-- (`normalizedSupplier` / `normalizedInvoiceNumber`). Replace that index and add
-- a user-scoped file-hash index. All indexes are deliberately NON-UNIQUE so
-- legitimate duplicate invoices can still be recorded and reviewed.
drop index if exists public.invoices_user_supplier_number_idx;

create index if not exists invoices_user_hash_idx
  on public.invoices (user_id, file_sha256);

create index if not exists invoices_user_normalized_supplier_number_idx
  on public.invoices (
    user_id,
    lower(coalesce(extracted_data->>'normalizedSupplier', '')),
    lower(coalesce(extracted_data->>'normalizedInvoiceNumber', ''))
  );
