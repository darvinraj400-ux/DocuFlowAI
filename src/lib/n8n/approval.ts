import "server-only";
import { enqueueInvoiceApprovedWebhook } from "@/lib/inngest/enqueue";
import { getN8nConfig } from "@/lib/n8n/config";

export type ApprovedWebhookEnqueueStatus = "disabled" | "queued" | "failed";

/**
 * Queues the approved-invoice webhook without ever throwing. Approval success
 * must not depend on the downstream automation being configured or available.
 */
export async function enqueueApprovedInvoiceWebhook(input: {
  invoiceId: string;
  ownerId: string;
  approvedAt: string;
}): Promise<ApprovedWebhookEnqueueStatus> {
  if (!getN8nConfig().enabled) return "disabled";

  try {
    await enqueueInvoiceApprovedWebhook(input);
    return "queued";
  } catch (err) {
    console.error(
      "[n8n] could not queue approved-invoice webhook",
      JSON.stringify({
        invoiceId: input.invoiceId,
        errorName: err instanceof Error ? err.name : "Error",
      }),
    );
    return "failed";
  }
}
