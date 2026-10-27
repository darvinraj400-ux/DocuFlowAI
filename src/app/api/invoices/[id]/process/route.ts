import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInvoice, STALE_CLAIM_MS, type DatabaseAdapter, type StorageAdapter, type InvoiceRowMin } from "@/lib/pipeline/execute";
import { createProvider } from "@/lib/providers";
import { getAiConfig } from "@/lib/env";
import { INVOICE_BUCKET } from "@/lib/storage";
import type { ExistingInvoiceBrief } from "@/lib/pipeline/duplicates";

export const maxDuration = 60;

function buildAdapters(admin: ReturnType<typeof createAdminClient>): { db: DatabaseAdapter; storage: StorageAdapter } {
  const db: DatabaseAdapter = {
    getOwnedInvoice: async (id, userId) => {
      const { data } = await admin.from("invoices").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      return (data as InvoiceRowMin | null) ?? null;
    },
    countActiveProcessing: async (userId) => {
      const { count } = await admin
        .from("invoices")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("status", "processing");
      return count ?? 0;
    },
    claimForProcessing: async (id, userId) => {
      const castFrom = async (statuses: string[]) => {
        const { data } = await admin
          .from("invoices")
          .update({ status: "processing" })
          .eq("id", id)
          .eq("user_id", userId)
          .in("status", statuses)
          .select("id")
          .maybeSingle();
        return Boolean(data);
      };
      if (await castFrom(["uploaded", "failed"])) return true;
      const staleTs = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      const { data } = await admin
        .from("invoices")
        .update({ status: "processing" })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("status", "processing")
        .lt("updated_at", staleTs)
        .select("id")
        .maybeSingle();
      return Boolean(data);
    },
    fetchExistingForDuplicates: async (userId, excludeId) => {
      const { data } = await admin
        .from("invoices")
        .select("id,file_sha256,extracted_data")
        .eq("user_id", userId)
        .neq("id", excludeId);
      return (data ?? []) as ExistingInvoiceBrief[];
    },
    saveExtraction: async (id, payload) => {
      const { error } = await admin
        .from("invoices")
        .update({
          status: "needs_review",
          file_sha256: payload.fileSha256,
          extracted_data: payload.extractedData,
          reviewed_data: null,
          validation_findings: payload.findings,
          duplicate_flags: payload.duplicateFlags,
          extraction_meta: payload.extractionMeta,
          error_info: null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    insertLineItems: async (id, items) => {
      // Idempotent: only the winning claim reaches here, and a retry after a
      // partial failure must never accumulate duplicate line items.
      const lineItems = items ?? [];
      const { error: deleteError } = await admin
        .from("invoice_line_items")
        .delete()
        .eq("invoice_id", id);
      if (deleteError) throw deleteError;
      if (!lineItems.length) return;
      const rows = lineItems.map((item) => ({
        invoice_id: id,
        description: item.description ?? "",
        quantity: item.quantity,
        unit_price: item.unitPrice,
        tax_amount: item.taxAmount,
        line_total: item.lineTotal,
      }));
      const { error } = await admin.from("invoice_line_items").insert(rows);
      if (error) throw error;
    },
    recordEvent: async (event) => {
      const { error } = await admin.from("invoice_events").insert({
        invoice_id: event.invoiceId,
        actor: event.actor,
        event_type: event.eventType,
        before_changes: event.before,
        after_changes: event.after,
        metadata: event.metadata,
      });
      if (error) throw error;
    },
    markFailed: async (id, userId, errorInfo) => {
      await admin.from("invoices").update({ status: "failed", error_info: errorInfo }).eq("id", id).eq("user_id", userId);
    },
    readExtractionMeta: async (id) => {
      const { data } = await admin.from("invoices").select("extraction_meta").eq("id", id).maybeSingle();
      return (data?.extraction_meta as Record<string, unknown> | null | undefined) ?? null;
    },
    writeExtractionMeta: async (id, meta) => {
      await admin.from("invoices").update({ extraction_meta: meta }).eq("id", id);
    },
  };

  const storage: StorageAdapter = {
    objectExists: async (path) => {
      const slash = path.lastIndexOf("/");
      const directory = slash >= 0 ? path.slice(0, slash) : "";
      const file = slash >= 0 ? path.slice(slash + 1) : path;
      const { data } = await admin.storage.from(INVOICE_BUCKET).list(directory, { search: file });
      return Array.isArray(data) && data.some((object) => object.name === file);
    },
    download: async (path) => {
      const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(path);
      if (error || !data) throw new Error("Could not download the stored file.");
      return new Uint8Array(await data.arrayBuffer());
    },
  };

  return { db, storage };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let provider;
  try {
    provider = createProvider();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provider not configured." },
      { status: 500 },
    );
  }

  let admin;
  let config;
  try {
    admin = createAdminClient();
    config = getAiConfig();
  } catch (err) {
    // TEMP DIAG: safe fields only; never log keys or headers.
    console.error("[process-diag] server config error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const { db, storage } = buildAdapters(admin);

  const result = await processInvoice({ invoiceId: id, userId: user.id, db, storage, provider, config });

  if (result.outcome === "conflict" && result.status === 404) {
    // TEMP DIAG: single pre-serialized string (JSON object arguments can be
    // stripped by the dev-log formatter). Safe fields only — invoice id,
    // types/lengths, and booleans. No user data, tokens, or file contents.
    try {
      const { data: byId } = await admin.from("invoices").select("id").eq("id", id).maybeSingle();
      const { data: owned } = await admin
        .from("invoices")
        .select("id")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      console.error(
        "[process-diag] notFound " +
          JSON.stringify({
            invoiceId: id,
            idType: typeof id,
            idLength: typeof id === "string" ? id.length : null,
            rowExistsById: Boolean(byId),
            ownershipMatch: Boolean(owned),
          }),
      );
    } catch {
      // diagnostic failure is non-fatal
    }
  }

  switch (result.outcome) {
    case "success":
      return NextResponse.json({ invoiceId: result.invoiceId, status: "needs_review" });
    case "conflict":
      return NextResponse.json({ error: result.message }, { status: result.status });
    case "error":
      return NextResponse.json({ error: result.message }, { status: result.status });
  }
}