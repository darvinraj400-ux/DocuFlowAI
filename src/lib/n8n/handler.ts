import { NonRetriableError } from "inngest";
import { parseApprovedWebhookEvent } from "@/lib/inngest/events";
import type { N8nConfig } from "@/lib/n8n/config";
import type { WebhookDeliveryInput, WebhookDeliveryResult } from "@/lib/n8n/delivery";
import {
  buildApprovedInvoicePayload,
  type ApprovedInvoicePayload,
} from "@/lib/n8n/payload";
import type { WebhookStore } from "@/lib/n8n/store";

export interface ApprovedWebhookDeps {
  config: N8nConfig;
  store: WebhookStore;
  deliver: (input: WebhookDeliveryInput) => Promise<WebhookDeliveryResult>;
}

export interface ApprovedWebhookStepTools {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
}

export interface ApprovedWebhookContext {
  event: { data: unknown };
  step: ApprovedWebhookStepTools;
}

export type ApprovedWebhookSkipReason =
  | "not_configured"
  | "not_found"
  | "not_approved"
  | "already_sent";

export type ApprovedWebhookResult =
  | { status: "sent"; invoiceId: string; attempts: number; httpStatus: number }
  | { status: "skipped"; invoiceId: string; reason: ApprovedWebhookSkipReason }
  | {
      status: "failed";
      invoiceId: string;
      code: string;
      attempts: number;
      httpStatus?: number;
    };

export type ApprovedWebhookHandler = (
  ctx: ApprovedWebhookContext,
) => Promise<ApprovedWebhookResult>;

type PreparedPayload =
  | { status: "ready"; payload: ApprovedInvoicePayload }
  | { status: "not_found" }
  | { status: "not_approved" };

type DeliveryStep =
  | { skipped: true }
  | { skipped: false; result: WebhookDeliveryResult };

function logAuditFailure(action: string, invoiceId: string, err: unknown): void {
  console.error(
    `[n8n] ${action}`,
    JSON.stringify({
      invoiceId,
      errorName: err instanceof Error ? err.name : "Error",
    }),
  );
}

/**
 * Durable orchestration for the approved-invoice webhook. The payload is built
 * inside a step so only the allowlisted fields — not the full extraction — are
 * persisted as step output. Delivery failures are recorded and returned, never
 * thrown, so Inngest does not multiply the bounded internal retries.
 */
export function createSendApprovedWebhookHandler(
  getDeps: () => ApprovedWebhookDeps,
): ApprovedWebhookHandler {
  return async ({ event, step }) => {
    const parsed = parseApprovedWebhookEvent(event.data);
    if (!parsed) {
      throw new NonRetriableError("Invalid invoice approved webhook event payload.");
    }

    const initial = getDeps();
    if (!initial.config.enabled || !initial.config.webhookUrl) {
      return { status: "skipped", invoiceId: parsed.invoiceId, reason: "not_configured" };
    }

    const prepared = await step.run("prepare-webhook-payload", async (): Promise<PreparedPayload> => {
      const invoice = await getDeps().store.loadInvoice(parsed);
      if (!invoice) return { status: "not_found" };
      if (invoice.status !== "approved") return { status: "not_approved" };
      return {
        status: "ready",
        payload: buildApprovedInvoicePayload(invoice, parsed.approvedAt),
      };
    });

    if (prepared.status !== "ready") {
      return {
        status: "skipped",
        invoiceId: parsed.invoiceId,
        reason: prepared.status,
      };
    }

    const alreadySent = await step.run("check-webhook-delivered", async () =>
      getDeps().store.hasDelivered(parsed.invoiceId),
    );
    if (alreadySent) {
      return { status: "skipped", invoiceId: parsed.invoiceId, reason: "already_sent" };
    }

    const delivery = await step.run("deliver-webhook", async (): Promise<DeliveryStep> => {
      const deps = getDeps();
      if (!deps.config.enabled || !deps.config.webhookUrl) return { skipped: true };

      const result = await deps.deliver({
        url: deps.config.webhookUrl,
        payload: prepared.payload,
        idempotencyKey: `invoice-approved:${parsed.invoiceId}`,
      });

      if (result.ok) {
        try {
          await deps.store.recordDelivered({
            invoiceId: parsed.invoiceId,
            ownerId: parsed.ownerId,
            httpStatus: result.status,
            attempts: result.attempts,
          });
        } catch (err) {
          // The downstream action already happened; a retry would duplicate it.
          logAuditFailure("could not record webhook delivery", parsed.invoiceId, err);
        }
      } else {
        try {
          await deps.store.recordFailure({
            invoiceId: parsed.invoiceId,
            ownerId: parsed.ownerId,
            code: result.code,
            httpStatus: result.status,
            attempts: result.attempts,
          });
        } catch (err) {
          logAuditFailure("could not record webhook failure", parsed.invoiceId, err);
        }
      }

      return { skipped: false, result };
    });

    if (delivery.skipped) {
      return { status: "skipped", invoiceId: parsed.invoiceId, reason: "not_configured" };
    }

    const result = delivery.result;
    if (!result.ok) {
      // Safe fields only: never the webhook URL, headers, or response body.
      console.error(
        "[n8n] webhook delivery failed",
        JSON.stringify({
          invoiceId: parsed.invoiceId,
          code: result.code,
          httpStatus: result.status ?? null,
          attempts: result.attempts,
        }),
      );
      return {
        status: "failed",
        invoiceId: parsed.invoiceId,
        code: result.code,
        attempts: result.attempts,
        httpStatus: result.status,
      };
    }

    return {
      status: "sent",
      invoiceId: parsed.invoiceId,
      attempts: result.attempts,
      httpStatus: result.status,
    };
  };
}
