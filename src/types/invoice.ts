/**
 * Invoice domain types. These match the database schema in
 * `supabase/migrations/00001_invoice_schema.sql`.
 */

/** Processing states enforced by the application and the database. */
export const INVOICE_STATUSES = [
  "uploaded",
  "processing",
  "needs_review",
  "approved",
  "rejected",
  "failed",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Audit/event types recorded in `invoice_events`. */
export const INVOICE_EVENT_TYPES = [
  "uploaded",
  "processing_started",
  "processing_succeeded",
  "processing_failed",
  "needs_review",
  "approved",
  "rejected",
  "status_changed",
  "webhook_sent",
] as const;

export type InvoiceEventType = (typeof INVOICE_EVENT_TYPES)[number];

/**
 * Allowed status transitions.
 * - A record only becomes `approved` via explicit human action.
 * - `failed` records can be retried (back to `processing`).
 * - `needs_review` records can be approved or rejected.
 */
export const VALID_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  uploaded: ["processing", "failed"],
  processing: ["needs_review", "failed"],
  needs_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
  failed: ["processing"],
};

export function canTransition(
  from: InvoiceStatus,
  to: InvoiceStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Field-level validation finding attached to an invoice. */
export interface ValidationFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  field?: string;
}

/** Duplicate indicators detected by the pipeline. */
export interface DuplicateFlags {
  duplicateHash?: boolean;
  duplicateNumber?: boolean;
  matchedInvoiceId?: string;
}

/** Row shape for the `invoices` table. */
export interface InvoiceRecord {
  id: string;
  user_id: string;
  original_filename: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  file_sha256: string;
  status: InvoiceStatus;
  extracted_data: Record<string, unknown> | null;
  reviewed_data: Record<string, unknown> | null;
  validation_findings: ValidationFinding[] | null;
  duplicate_flags: DuplicateFlags | null;
  extraction_meta: Record<string, unknown> | null;
  error_info: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}
