import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ApprovedInvoiceRecord {
  id: string;
  status: string;
  extracted_data: unknown;
  reviewed_data: unknown;
  reviewed_at: string | null;
}

export interface WebhookStore {
  loadInvoice(input: { invoiceId: string; ownerId: string }): Promise<ApprovedInvoiceRecord | null>;
  hasDelivered(invoiceId: string): Promise<boolean>;
  recordDelivered(input: {
    invoiceId: string;
    ownerId: string;
    httpStatus: number;
    attempts: number;
  }): Promise<void>;
  recordFailure(input: {
    invoiceId: string;
    ownerId: string;
    code: string;
    httpStatus?: number;
    attempts: number;
  }): Promise<void>;
}

/**
 * Service-role store for webhook delivery. Every invoice read is scoped by
 * both id and owner, and the delivery marker is an append-only audit event so
 * no schema migration is required.
 */
export function createSupabaseWebhookStore(
  admin: SupabaseClient = createAdminClient(),
): WebhookStore {
  async function insertEvent(row: Record<string, unknown>): Promise<void> {
    const { error } = await admin.from("invoice_events").insert(row);
    if (error) throw error;
  }

  return {
    loadInvoice: async ({ invoiceId, ownerId }) => {
      const { data, error } = await admin
        .from("invoices")
        .select("id,status,extracted_data,reviewed_data,reviewed_at")
        .eq("id", invoiceId)
        .eq("user_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id as string,
        status: data.status as string,
        extracted_data: data.extracted_data ?? null,
        reviewed_data: data.reviewed_data ?? null,
        reviewed_at: (data.reviewed_at as string | null) ?? null,
      };
    },

    hasDelivered: async (invoiceId) => {
      const { data, error } = await admin
        .from("invoice_events")
        .select("id")
        .eq("invoice_id", invoiceId)
        .eq("event_type", "webhook_sent")
        .limit(1);
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },

    recordDelivered: async ({ invoiceId, ownerId, httpStatus, attempts }) => {
      await insertEvent({
        invoice_id: invoiceId,
        actor: ownerId,
        event_type: "webhook_sent",
        metadata: { httpStatus, attempts },
      });
    },

    recordFailure: async ({ invoiceId, ownerId, code, httpStatus, attempts }) => {
      // The enum has no `webhook_failed` member; use status_changed with a
      // stable action marker instead of adding a migration.
      await insertEvent({
        invoice_id: invoiceId,
        actor: ownerId,
        event_type: "status_changed",
        metadata: {
          action: "webhook_delivery_failed",
          code,
          httpStatus: httpStatus ?? null,
          attempts,
        },
      });
    },
  };
}
