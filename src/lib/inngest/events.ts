import { z } from "zod";

export const INVOICE_PROCESSING_REQUESTED = "invoice/processing.requested";

export interface InvoiceProcessingRequestedData {
  invoiceId: string;
  ownerId: string;
  jobId: string;
}

const eventDataSchema = z.object({
  invoiceId: z.uuid(),
  ownerId: z.uuid(),
  jobId: z.string().min(8).max(128),
});

/** Events are a trust boundary: only identifiers this app issued are accepted. */
export function parseProcessingEvent(data: unknown): InvoiceProcessingRequestedData | null {
  const result = eventDataSchema.safeParse(data);
  return result.success ? result.data : null;
}

export const INVOICE_APPROVED_WEBHOOK_REQUESTED = "invoice/approved.webhook.requested";

export interface InvoiceApprovedWebhookData {
  invoiceId: string;
  ownerId: string;
  approvedAt: string;
}

const approvedWebhookEventDataSchema = z.object({
  invoiceId: z.uuid(),
  ownerId: z.uuid(),
  approvedAt: z.iso.datetime(),
});

/** Events are a trust boundary: only identifiers this app issued are accepted. */
export function parseApprovedWebhookEvent(data: unknown): InvoiceApprovedWebhookData | null {
  const result = approvedWebhookEventDataSchema.safeParse(data);
  return result.success ? result.data : null;
}
