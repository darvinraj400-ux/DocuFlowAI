import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { INVOICE_BUCKET } from "@/lib/storage";
import { validateUploadedFile } from "@/lib/file-validation";
import { sha256Hex } from "@/lib/hash";
import type { ExtractionResult } from "@/lib/pipeline/schema";
import {
  BATCH_PAGE_SIZE,
  DOCUMENT_CHECKPOINT_KEY,
  batchRangeKey,
  buildBatchRanges,
  mergeBatchedExtraction,
  singleDocumentExtraction,
} from "@/lib/pipeline/batch-plan";
import {
  captureCoverageFindings,
  materialConflictFindings,
  validateExtraction,
} from "@/lib/pipeline/validate";
import { deriveDuplicateKeys, toStoredExtraction } from "@/lib/pipeline/normalize";
import { detectDuplicates, type ExistingInvoiceBrief } from "@/lib/pipeline/duplicates";
import type { ExtractionProvider, PageRangedProvider } from "@/lib/providers/types";
import type { DuplicateFlags, InvoiceStatus, ValidationFinding } from "@/types/invoice";

/** How long a `processing` claim may sit before another job may reclaim it. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface JobInvoice {
  id: string;
  ownerId: string;
  status: InvoiceStatus;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  updatedAt: string;
  extractionMeta: Record<string, unknown> | null;
}

export type ClaimResult =
  | { claimed: true; invoice: JobInvoice }
  | { claimed: false; reason: "not_found" | "busy" | "ineligible"; status?: InvoiceStatus };

export interface CheckpointProviderMeta {
  provider?: string;
  model?: string;
  demo?: boolean;
  durationMs?: number;
}

export interface BatchCheckpoint {
  key: string;
  from?: number;
  to?: number;
  ok: boolean;
  processedPages: number;
  truncated?: boolean;
  code?: string;
  message?: string;
  snapshot?: ExtractionResult;
  providerMeta?: CheckpointProviderMeta;
  at: string;
}

export interface BatchMeta {
  fileSha256: string;
  pageCount: number;
  totalRanges: number;
  ranges: Record<string, BatchCheckpoint>;
}

export type PrepareResult =
  | {
      ok: true;
      fileHash: string;
      mimeType: string;
      pageCount: number;
      batched: boolean;
      providerId: string;
      providerDemo: boolean;
    }
  | { ok: false; code: string; message: string; superseded?: boolean };

export type FinalizeResult =
  | { outcome: "saved" }
  | { outcome: "skipped"; reason: "fence_lost" }
  | { outcome: "all_failed"; message: string; codes: string[] }
  | { outcome: "missing_checkpoints"; keys: string[] };

export interface FinalizeInput {
  invoice: JobInvoice;
  jobId: string;
  prepared: {
    fileHash: string;
    pageCount: number;
    batched: boolean;
    providerId: string;
    providerDemo: boolean;
  };
  expectedKeys: string[];
}

export interface InvoiceJobStore {
  claimJob(input: { invoiceId: string; ownerId: string; jobId: string }): Promise<ClaimResult>;
  prepareDocument(input: {
    invoice: JobInvoice;
    jobId: string;
    maxPdfPages: number;
    provider: ExtractionProvider;
  }): Promise<PrepareResult>;
  readCheckpoint(input: {
    invoiceId: string;
    ownerId: string;
    fileSha256: string;
    key: string;
  }): Promise<BatchCheckpoint | null>;
  writeCheckpoint(input: {
    invoiceId: string;
    ownerId: string;
    jobId: string;
    fileSha256: string;
    checkpoint: BatchCheckpoint;
  }): Promise<boolean>;
  objectExists(storagePath: string): Promise<boolean>;
  downloadDocument(storagePath: string): Promise<Uint8Array>;
  finalizeJob(input: FinalizeInput): Promise<FinalizeResult>;
  markJobFailed(input: {
    invoiceId: string;
    ownerId: string;
    jobId: string;
    errorInfo: Record<string, unknown>;
  }): Promise<boolean>;
  recordEvent(input: {
    invoiceId: string;
    actor: string;
    eventType: string;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  }): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBatchMeta(meta: unknown): BatchMeta | null {
  if (!isRecord(meta)) return null;
  const batches = meta._batches;
  if (!isRecord(batches)) return null;
  if (typeof batches.fileSha256 !== "string" || typeof batches.pageCount !== "number") return null;
  if (!isRecord(batches.ranges)) return null;
  return {
    fileSha256: batches.fileSha256,
    pageCount: batches.pageCount,
    totalRanges: typeof batches.totalRanges === "number" ? batches.totalRanges : 0,
    ranges: batches.ranges as Record<string, BatchCheckpoint>,
  };
}

function validationCode(err: unknown): string {
  if (err instanceof Error && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "INVALID_FILE";
}

function safeMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() ? message.slice(0, 500) : fallback;
}

/**
 * Supabase-backed store for durable invoice jobs. Uses the service-role client
 * because background jobs have no browser session, so every read and write is
 * explicitly scoped by `user_id`, and every mutation is fenced by the job id
 * stored in `extraction_meta` plus a conditional status transition.
 */
export function createSupabaseInvoiceJobStore(
  admin: SupabaseClient = createAdminClient(),
): InvoiceJobStore {
  async function readMetaRaw(invoiceId: string, ownerId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await admin
      .from("invoices")
      .select("extraction_meta")
      .eq("id", invoiceId)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error) throw error;
    return isRecord(data?.extraction_meta) ? data.extraction_meta : null;
  }

  async function writeMetaFenced(input: {
    invoiceId: string;
    ownerId: string;
    jobId: string;
    meta: Record<string, unknown>;
  }): Promise<boolean> {
    const { data, error } = await admin
      .from("invoices")
      .update({ extraction_meta: input.meta })
      .eq("id", input.invoiceId)
      .eq("user_id", input.ownerId)
      .eq("status", "processing")
      .contains("extraction_meta", { _jobId: input.jobId })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async function recordEvent(input: {
    invoiceId: string;
    actor: string;
    eventType: string;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  }): Promise<void> {
    try {
      await admin.from("invoice_events").insert({
        invoice_id: input.invoiceId,
        actor: input.actor,
        event_type: input.eventType,
        before_changes: input.before,
        after_changes: input.after,
        metadata: input.metadata,
      });
    } catch {
      // Audit history is non-fatal: never fail a persisted extraction for an event.
    }
  }

  const store: InvoiceJobStore = {
    claimJob: async ({ invoiceId, ownerId, jobId }) => {
      const { data: row, error } = await admin
        .from("invoices")
        .select("id,user_id,status,storage_path,original_filename,mime_type,updated_at,extraction_meta")
        .eq("id", invoiceId)
        .eq("user_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      if (!row) return { claimed: false, reason: "not_found" };

      const status = row.status as InvoiceStatus;
      const staleProcessing =
        status === "processing" &&
        Date.now() - new Date(row.updated_at).getTime() > STALE_CLAIM_MS;

      if (status !== "uploaded" && status !== "failed" && !staleProcessing) {
        return {
          claimed: false,
          reason: status === "processing" ? "busy" : "ineligible",
          status,
        };
      }

      const jobStartedAt = new Date().toISOString();
      const baseMeta = isRecord(row.extraction_meta) ? row.extraction_meta : {};
      const nextMeta: Record<string, unknown> = {
        ...baseMeta,
        _jobId: jobId,
        _jobStartedAt: jobStartedAt,
      };

      let update = admin
        .from("invoices")
        .update({ status: "processing", error_info: null, extraction_meta: nextMeta })
        .eq("id", invoiceId)
        .eq("user_id", ownerId);

      if (staleProcessing) {
        const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
        update = update.eq("status", "processing").lt("updated_at", staleBefore);
      } else {
        update = update.in("status", ["uploaded", "failed"]);
      }

      const { data: won, error: updateError } = await update.select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!won) return { claimed: false, reason: "busy" };

      return {
        claimed: true,
        invoice: {
          id: row.id as string,
          ownerId,
          status: "processing",
          storagePath: row.storage_path as string,
          originalFilename: row.original_filename as string,
          mimeType: row.mime_type as string,
          updatedAt: jobStartedAt,
          extractionMeta: nextMeta,
        },
      };
    },

    prepareDocument: async ({ invoice, jobId, maxPdfPages, provider }) => {
      const exists = await store.objectExists(invoice.storagePath);
      if (!exists) {
        return {
          ok: false,
          code: "FILE_MISSING",
          message: "The uploaded file could not be found in storage.",
        };
      }

      const bytes = await store.downloadDocument(invoice.storagePath);

      let validated;
      try {
        validated = await validateUploadedFile({
          bytes,
          filename: invoice.originalFilename,
          declaredMimeType: invoice.mimeType,
          maxPdfPages,
        });
      } catch (err) {
        return {
          ok: false,
          code: validationCode(err),
          message: safeMessage(err, "The uploaded file is not valid."),
        };
      }

      const fileHash = sha256Hex(validated.bytes);
      const pageCount = validated.pageCount ?? 1;
      const supportsRanges = typeof (provider as Partial<PageRangedProvider>).extractRange === "function";
      const batched =
        validated.actualMimeType === "application/pdf" &&
        supportsRanges &&
        pageCount > BATCH_PAGE_SIZE;

      const expectedKeys = new Set(
        batched ? buildBatchRanges(pageCount).map(batchRangeKey) : [DOCUMENT_CHECKPOINT_KEY],
      );

      const prior = parseBatchMeta(invoice.extractionMeta);
      const keptRanges: Record<string, BatchCheckpoint> = {};
      if (prior?.fileSha256 === fileHash) {
        for (const [key, checkpoint] of Object.entries(prior.ranges)) {
          if (checkpoint.ok && expectedKeys.has(key)) keptRanges[key] = checkpoint;
        }
      }

      const meta: Record<string, unknown> = {
        ...(invoice.extractionMeta ?? {}),
        _jobId: jobId,
        _jobStartedAt: new Date().toISOString(),
        _batches: {
          fileSha256: fileHash,
          pageCount,
          totalRanges: expectedKeys.size,
          ranges: keptRanges,
        },
      };

      const written = await writeMetaFenced({
        invoiceId: invoice.id,
        ownerId: invoice.ownerId,
        jobId,
        meta,
      });
      if (!written) {
        return {
          ok: false,
          code: "JOB_SUPERSEDED",
          message: "Another processing job took over this invoice.",
          superseded: true,
        };
      }

      return {
        ok: true,
        fileHash,
        mimeType: validated.actualMimeType,
        pageCount,
        batched,
        providerId: provider.id,
        providerDemo: provider.demo,
      };
    },

    readCheckpoint: async ({ invoiceId, ownerId, fileSha256, key }) => {
      const meta = await readMetaRaw(invoiceId, ownerId);
      const batches = parseBatchMeta(meta);
      if (!batches || batches.fileSha256 !== fileSha256) return null;
      return batches.ranges[key] ?? null;
    },

    writeCheckpoint: async ({ invoiceId, ownerId, jobId, fileSha256, checkpoint }) => {
      const raw = await readMetaRaw(invoiceId, ownerId);
      const batches = parseBatchMeta(raw);
      if (!batches || batches.fileSha256 !== fileSha256) return false;

      const meta: Record<string, unknown> = {
        ...(raw ?? {}),
        _batches: {
          ...batches,
          ranges: { ...batches.ranges, [checkpoint.key]: checkpoint },
        },
      };

      return writeMetaFenced({ invoiceId, ownerId, jobId, meta });
    },

    downloadDocument: async (storagePath) => {
      const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(storagePath);
      if (error || !data) throw new Error("Could not download the stored file.");
      return new Uint8Array(await data.arrayBuffer());
    },

    finalizeJob: async ({ invoice, jobId, prepared, expectedKeys }) => {
      const { data: current, error: currentError } = await admin
        .from("invoices")
        .select("status,extraction_meta")
        .eq("id", invoice.id)
        .eq("user_id", invoice.ownerId)
        .maybeSingle();
      if (currentError) throw currentError;

      const raw = isRecord(current?.extraction_meta) ? current.extraction_meta : null;
      if (current?.status === "needs_review" && raw?._jobId === jobId) {
        // This exact job already committed; a retried step is a no-op.
        return { outcome: "saved" };
      }
      if (current?.status !== "processing") {
        return { outcome: "skipped", reason: "fence_lost" };
      }

      const batches = parseBatchMeta(raw);
      const missing = !batches || batches.fileSha256 !== prepared.fileHash
        ? [...expectedKeys]
        : expectedKeys.filter((key) => !batches.ranges[key]);

      if (missing.length > 0) {
        return { outcome: "missing_checkpoints", keys: missing };
      }

      const records: BatchCheckpoint[] = expectedKeys.map((key) => batches!.ranges[key]);
      const failedRecords = records.filter((record) => !record.ok);
      if (failedRecords.length === records.length) {
        return {
          outcome: "all_failed",
          message: failedRecords[0]?.message ?? "Every extraction batch failed.",
          codes: Array.from(new Set(failedRecords.map((record) => record.code ?? "EXTRACTION_FAILED"))),
        };
      }

      const missingSnapshots = records.filter((record) => record.ok && !record.snapshot).map((record) => record.key);
      if (missingSnapshots.length > 0) {
        return { outcome: "missing_checkpoints", keys: missingSnapshots };
      }

      const extraction = prepared.batched
        ? mergeBatchedExtraction({ pageCount: prepared.pageCount, records })
        : singleDocumentExtraction(
            records.find((record) => record.key === DOCUMENT_CHECKPOINT_KEY)!.snapshot!,
            prepared.pageCount,
          );

      const findings: ValidationFinding[] = [
        ...validateExtraction(extraction),
        ...captureCoverageFindings(extraction),
        ...materialConflictFindings(extraction),
      ];
      const keys = deriveDuplicateKeys(extraction);

      const { data: existingRows, error: duplicateError } = await admin
        .from("invoices")
        .select("id,file_sha256,extracted_data")
        .eq("user_id", invoice.ownerId)
        .neq("id", invoice.id);
      if (duplicateError) throw duplicateError;

      const duplicateFlags: DuplicateFlags = detectDuplicates({
        fileHash: prepared.fileHash,
        supplierKey: keys.supplierKey,
        invoiceNumberKey: keys.invoiceNumberKey,
        existing: (existingRows ?? []) as ExistingInvoiceBrief[],
      });

      const owned = await admin
        .from("invoices")
        .select("id")
        .eq("id", invoice.id)
        .eq("user_id", invoice.ownerId)
        .eq("status", "processing")
        .contains("extraction_meta", { _jobId: jobId })
        .maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return { outcome: "skipped", reason: "fence_lost" };

      // Line items are replaced, never appended, so a retried finalize cannot
      // duplicate them. This runs before the fenced status update.
      const items = extraction.lineItems ?? [];
      const { error: deleteError } = await admin
        .from("invoice_line_items")
        .delete()
        .eq("invoice_id", invoice.id);
      if (deleteError) throw deleteError;
      if (items.length > 0) {
        const { error: insertError } = await admin.from("invoice_line_items").insert(
          items.map((item) => ({
            invoice_id: invoice.id,
            description: item.description ?? "",
            quantity: item.quantity,
            unit_price: item.unitPrice,
            tax_amount: item.taxAmount,
            line_total: item.lineTotal,
          })),
        );
        if (insertError) throw insertError;
      }

      const finishedAt = new Date().toISOString();
      const succeeded = records.filter((record) => record.ok);
      const providerMeta = succeeded[0]?.providerMeta;
      const finalMeta: Record<string, unknown> = {
        provider: prepared.providerId,
        model: prepared.batched ? "batched" : providerMeta?.model ?? null,
        demo: prepared.providerDemo,
        batched: prepared.batched,
        batches: records.length,
        jobId,
        _jobId: jobId,
        _jobStartedAt: typeof raw?._jobStartedAt === "string" ? raw._jobStartedAt : null,
        _jobFinishedAt: finishedAt,
        _batches: {
          fileSha256: prepared.fileHash,
          pageCount: prepared.pageCount,
          totalRanges: records.length,
          ranges: Object.fromEntries(
            records.map((record) => [
              record.key,
              {
                key: record.key,
                from: record.from,
                to: record.to,
                ok: record.ok,
                processedPages: record.processedPages,
                truncated: record.truncated ?? false,
                code: record.code,
                message: record.message,
                at: record.at,
              },
            ]),
          ),
        },
      };

      const { data: saved, error: saveError } = await admin
        .from("invoices")
        .update({
          status: "needs_review",
          file_sha256: prepared.fileHash,
          extracted_data: toStoredExtraction(extraction),
          reviewed_data: null,
          validation_findings: findings,
          duplicate_flags: duplicateFlags,
          extraction_meta: finalMeta,
          error_info: null,
        })
        .eq("id", invoice.id)
        .eq("user_id", invoice.ownerId)
        .eq("status", "processing")
        .contains("extraction_meta", { _jobId: jobId })
        .select("id")
        .maybeSingle();
      if (saveError) throw saveError;

      if (!saved) {
        // A retried finalize may find this job already committed. Treat only
        // that exact state as success; never overwrite a newer job's result.
        const { data: current, error: currentError } = await admin
          .from("invoices")
          .select("status,extraction_meta")
          .eq("id", invoice.id)
          .eq("user_id", invoice.ownerId)
          .maybeSingle();
        if (currentError) throw currentError;
        const currentMeta = isRecord(current?.extraction_meta) ? current.extraction_meta : null;
        if (current?.status === "needs_review" && currentMeta?._jobId === jobId) {
          return { outcome: "saved" };
        }
        return { outcome: "skipped", reason: "fence_lost" };
      }

      await recordEvent({
        invoiceId: invoice.id,
        actor: invoice.ownerId,
        eventType: "processing_succeeded",
        after: {
          status: "needs_review",
          findings: findings.length,
          duplicates: Object.keys(duplicateFlags),
        },
        metadata: {
          provider: prepared.providerId,
          demo: prepared.providerDemo,
          batched: prepared.batched,
        },
      });
      await recordEvent({
        invoiceId: invoice.id,
        actor: invoice.ownerId,
        eventType: "needs_review",
        after: { status: "needs_review" },
      });

      return { outcome: "saved" };
    },

    markJobFailed: async ({ invoiceId, ownerId, jobId, errorInfo }) => {
      const raw = await readMetaRaw(invoiceId, ownerId);
      const meta: Record<string, unknown> = {
        ...(raw ?? {}),
        _jobId: jobId,
        _jobFailedAt: new Date().toISOString(),
      };

      const { data, error } = await admin
        .from("invoices")
        .update({ status: "failed", error_info: errorInfo, extraction_meta: meta })
        .eq("id", invoiceId)
        .eq("user_id", ownerId)
        .eq("status", "processing")
        .contains("extraction_meta", { _jobId: jobId })
        .select("id")
        .maybeSingle();
      if (error) throw error;

      if (data) {
        await recordEvent({
          invoiceId,
          actor: ownerId,
          eventType: "processing_failed",
          metadata: { code: errorInfo.code, jobId },
        });
      }

      return Boolean(data);
    },

    recordEvent,

    objectExists: async (path: string) => {
      const slash = path.lastIndexOf("/");
      const directory = slash >= 0 ? path.slice(0, slash) : "";
      const file = slash >= 0 ? path.slice(slash + 1) : path;
      const { data, error } = await admin.storage
        .from(INVOICE_BUCKET)
        .list(directory, { search: file });
      if (error) throw error;
      return Array.isArray(data) && data.some((object) => object.name === file);
    },
  };

  return store;
}
