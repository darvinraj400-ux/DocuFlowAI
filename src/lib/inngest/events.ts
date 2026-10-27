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
