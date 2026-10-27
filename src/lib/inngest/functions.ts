import { DEFAULT_MAX_CONCURRENT_PROCESSING, getAiConfig } from "@/lib/env";
import { createProvider } from "@/lib/providers";
import { inngest } from "@/lib/inngest/client";
import {
  INVOICE_APPROVED_WEBHOOK_REQUESTED,
  INVOICE_PROCESSING_REQUESTED,
  parseApprovedWebhookEvent,
  parseProcessingEvent,
} from "@/lib/inngest/events";
import { createProcessInvoiceHandler } from "@/lib/inngest/job-handler";
import { createSupabaseInvoiceJobStore } from "@/lib/inngest/job-store";
import { getN8nConfig } from "@/lib/n8n/config";
import { deliverWebhook } from "@/lib/n8n/delivery";
import { createSendApprovedWebhookHandler } from "@/lib/n8n/handler";
import { createSupabaseWebhookStore } from "@/lib/n8n/store";

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

const approvedWebhookHandler = createSendApprovedWebhookHandler(() => ({
  config: getN8nConfig(),
  store: createSupabaseWebhookStore(),
  deliver: deliverWebhook,
}));

export const sendInvoiceApprovedWebhookFunction = inngest.createFunction(
  {
    id: "send-invoice-approved-webhook",
    name: "Send approved invoice webhook",
    // HTTP delivery retries are bounded inside the handler. These retries only
    // cover unexpected infrastructure errors, so a controlled delivery failure
    // is returned once and never multiplied by the platform.
    retries: 2,
    concurrency: [{ limit: 1, key: "event.data.invoiceId" }],
    triggers: [{ event: INVOICE_APPROVED_WEBHOOK_REQUESTED }],
    onFailure: async ({ event, error }) => {
      const original = event.data.event as { data?: unknown } | undefined;
      const parsed = parseApprovedWebhookEvent(original?.data);
      if (!parsed) return;

      console.error(
        "[n8n] approved-webhook function failed",
        JSON.stringify({
          invoiceId: parsed.invoiceId,
          errorName: error?.name ?? "Error",
        }),
      );

      try {
        await createSupabaseWebhookStore().recordFailure({
          invoiceId: parsed.invoiceId,
          ownerId: parsed.ownerId,
          code: "WEBHOOK_FUNCTION_FAILED",
          attempts: 0,
        });
      } catch (err) {
        console.error(
          "[n8n] could not record terminal webhook failure",
          JSON.stringify({
            invoiceId: parsed.invoiceId,
            errorName: err instanceof Error ? err.name : "Error",
          }),
        );
      }
    },
  },
  approvedWebhookHandler,
);

export const functions = [processInvoiceFunction, sendInvoiceApprovedWebhookFunction];
