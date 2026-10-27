import { inngest, isInngestDevMode } from "@/lib/inngest/client";
import {
  INVOICE_APPROVED_WEBHOOK_REQUESTED,
  INVOICE_PROCESSING_REQUESTED,
  type InvoiceApprovedWebhookData,
  type InvoiceProcessingRequestedData,
} from "@/lib/inngest/events";

export class InngestNotConfiguredError extends Error {
  constructor() {
    super(
      isInngestDevMode()
        ? "The Inngest Dev Server is not reachable. Start it and retry."
        : "Inngest is not configured. Set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY on the server.",
    );
    this.name = "InngestNotConfiguredError";
  }
}

/** In dev the Dev Server is expected to be reachable; in cloud an event key is required. */
export function isInngestConfigured(): boolean {
  return isInngestDevMode() || Boolean(process.env.INNGEST_EVENT_KEY);
}

/**
 * Sends the minimal durable-processing event. Throws when the event was not
 * accepted so callers never report a false "queued" state.
 */
export async function enqueueInvoiceProcessing(data: InvoiceProcessingRequestedData): Promise<void> {
  if (!isInngestConfigured()) throw new InngestNotConfiguredError();

  const result = await inngest.send({
    id: `invoice-processing-${data.jobId}`,
    name: INVOICE_PROCESSING_REQUESTED,
    data,
  });

  if (!result?.ids?.length) throw new Error("Inngest did not accept the processing event.");
}

/**
 * Queues the approved-invoice webhook. The deterministic event id means a
 * repeated send for the same invoice is deduplicated by Inngest.
 */
export async function enqueueInvoiceApprovedWebhook(
  data: InvoiceApprovedWebhookData,
): Promise<void> {
  if (!isInngestConfigured()) throw new InngestNotConfiguredError();

  const result = await inngest.send({
    id: `invoice-approved-webhook-${data.invoiceId}`,
    name: INVOICE_APPROVED_WEBHOOK_REQUESTED,
    data,
  });

  if (!result?.ids?.length) {
    throw new Error("Inngest did not accept the approved-invoice webhook event.");
  }
}
