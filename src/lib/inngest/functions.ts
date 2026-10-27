import { DEFAULT_MAX_CONCURRENT_PROCESSING, getAiConfig } from "@/lib/env";
import { createProvider } from "@/lib/providers";
import { inngest } from "@/lib/inngest/client";
import { INVOICE_PROCESSING_REQUESTED, parseProcessingEvent } from "@/lib/inngest/events";
import { createProcessInvoiceHandler } from "@/lib/inngest/job-handler";
import { createSupabaseInvoiceJobStore } from "@/lib/inngest/job-store";

function userConcurrencyLimit(): number {
  const parsed = Number.parseInt(process.env.MAX_CONCURRENT_PROCESSING ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_PROCESSING;
}

const handler = createProcessInvoiceHandler(() => {
  const config = getAiConfig();
  return {
    store: createSupabaseInvoiceJobStore(),
    createProvider,
    maxPdfPages: config.maxPdfPages,
  };
});

export const processInvoiceFunction = inngest.createFunction(
  {
    id: "process-invoice",
    name: "Process invoice",
    // Bounded retries: transient provider/network failures retry a few times;
    // permanent provider errors are returned as failed checkpoints, not thrown.
    retries: 4,
    concurrency: [
      { limit: 1, key: "event.data.invoiceId" },
      { limit: userConcurrencyLimit(), key: "event.data.ownerId" },
    ],
    triggers: [{ event: INVOICE_PROCESSING_REQUESTED }],
    onFailure: async ({ event, error }) => {
      const original = event.data.event as { data?: unknown } | undefined;
      const parsed = parseProcessingEvent(original?.data);
      if (!parsed) return;

      try {
        const store = createSupabaseInvoiceJobStore();
        await store.markJobFailed({
          invoiceId: parsed.invoiceId,
          ownerId: parsed.ownerId,
          jobId: parsed.jobId,
          errorInfo: {
            code: "JOB_FAILED",
            message: "Processing did not complete after retries.",
            detail: (error?.message ?? "").slice(0, 500),
            jobId: parsed.jobId,
          },
        });
      } catch (err) {
        // TEMP DIAG: safe fields only; identifiers and message, never secrets.
        console.error(
          "[inngest-diag] could not record terminal job failure",
          JSON.stringify({
            invoiceId: parsed.invoiceId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
  },
  handler,
);

export const functions = [processInvoiceFunction];
