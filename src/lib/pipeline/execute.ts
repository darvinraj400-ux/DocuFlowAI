import type { ExtractionResult } from "@/lib/pipeline/schema";
import { captureCoverageFindings, materialConflictFindings, validateExtraction, hasErrorFindings } from "@/lib/pipeline/validate";
import { mergeBatchContributions } from "@/lib/pipeline/reconcile";
import { deriveDuplicateKeys, toStoredExtraction } from "@/lib/pipeline/normalize";
import { detectDuplicates, type ExistingInvoiceBrief } from "@/lib/pipeline/duplicates";
import { validateUploadedFile } from "@/lib/file-validation";
import { sha256Hex } from "@/lib/hash";
import type { ValidationFinding, DuplicateFlags, InvoiceStatus } from "@/types/invoice";
import type { ExtractionProvider, ExtractionOutcome, PageRangedProvider } from "@/lib/providers/types";
import type { AiConfig } from "@/lib/env";

const BATCH_PAGE_SIZE = 3;

export interface InvoiceRowMin {
  id: string;
  user_id: string;
  status: InvoiceStatus;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  updated_at: string;
}

export interface SaveExtractionPayload {
  fileSha256: string;
  extractedData: Record<string, unknown>;
  findings: ValidationFinding[];
  duplicateFlags: DuplicateFlags;
  extractionMeta: Record<string, unknown>;
}

export interface InvoiceEventInput {
  invoiceId: string;
  actor: string;
  eventType: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export interface DatabaseAdapter {
  getOwnedInvoice(id: string, userId: string): Promise<InvoiceRowMin | null>;
  countActiveProcessing(userId: string): Promise<number>;
  /** Atomic conditional claim. Returns true only if this caller won the claim. */
  claimForProcessing(invoiceId: string, userId: string): Promise<boolean>;
  fetchExistingForDuplicates(userId: string, excludeId: string): Promise<ExistingInvoiceBrief[]>;
  saveExtraction(invoiceId: string, payload: SaveExtractionPayload): Promise<void>;
  insertLineItems(invoiceId: string, items: ExtractionResult["lineItems"]): Promise<void>;
  recordEvent(event: InvoiceEventInput): Promise<void>;
  markFailed(invoiceId: string, userId: string, errorInfo: Record<string, unknown>): Promise<void>;
  /** Durable batch checkpoints (optional; used by batched extraction). */
  readExtractionMeta?(invoiceId: string): Promise<Record<string, unknown> | null>;
  writeExtractionMeta?(invoiceId: string, meta: Record<string, unknown>): Promise<void>;
}

export interface StorageAdapter {
  objectExists(path: string): Promise<boolean>;
  download(path: string): Promise<Uint8Array>;
}

export type ProcessResult =
  | { outcome: "success"; invoiceId: string }
  | { outcome: "conflict"; status: number; message: string }
  | { outcome: "error"; status: number; message: string };

/** How long a `processing` claim may sit before another request may reclaim it. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

async function extractPagesInBatches(args: {
  invoiceId: string;
  userId: string;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  provider: ExtractionProvider;
  input: { bytes: Uint8Array; mimeType: string; pageCount?: number | null };
  pageCount: number;
}): Promise<ExtractionOutcome> {
  const ranged = (args.provider as PageRangedProvider).extractRange;
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = 1; from <= args.pageCount; from += BATCH_PAGE_SIZE) {
    ranges.push({ from, to: Math.min(from + BATCH_PAGE_SIZE - 1, args.pageCount) });
  }

  interface BatchRecord { from: number; to: number; processedPages: number; ok: boolean; code?: string; message?: string; snapshot?: Partial<ExtractionResult>; }
  let records: BatchRecord[] = [];
  try {
    const raw = args.db.readExtractionMeta ? await args.db.readExtractionMeta(args.invoiceId) : null;
    if (raw && Array.isArray((raw as Record<string, unknown>)._completed_ranges)) {
      records = (raw as Record<string, unknown>)._completed_ranges as BatchRecord[];
    }
  } catch {
    records = [];
  }
  const done = new Set(records.filter((r) => r.ok).map((r) => `${r.from}-${r.to}`));

  let aggregated: Partial<ExtractionResult> = {};
  for (const rec of records.filter((r) => r.ok)) {
    if (rec.snapshot) aggregated = mergeBatchContributions(aggregated, rec.snapshot);
  }
  let anyTruncated = false;
  const failedRanges: string[] = [];
  const failures = records.filter((r) => !r.ok).map((r) => `${r.from}-${r.to}`);

  for (const range of ranges) {
    const key = `${range.from}-${range.to}`;
    if (done.has(key)) continue;
    const outcome = await ranged.call(args.provider, args.input, range);
    if (!outcome.ok) {
      const record: BatchRecord = { ...range, processedPages: 0, ok: false, code: outcome.error.code, message: outcome.error.message };
      records.push(record);
      failedRanges.push(key);
      if (outcome.error.code !== "timeout" && outcome.error.code !== "rate_limit" && outcome.error.code !== "provider_outage") break;
      continue;
    }
    aggregated = mergeBatchContributions(aggregated, outcome.data);
    const processedPages = outcome.data.capture?.pages?.length ?? 0;
    records.push({ ...range, processedPages, ok: true, snapshot: outcome.data });
    if (String(outcome.data.capture?.coverage?.note ?? "").toLowerCase().includes("truncated")) anyTruncated = true;
    try {
      if (args.db.writeExtractionMeta) {
        await args.db.writeExtractionMeta(args.invoiceId, { _completed_ranges: records });
      }
    } catch {
      // best effort checkpoint
    }
  }

  const totalProcessedPages = records.filter((r) => r.ok).reduce((sum, r) => sum + r.processedPages, 0);
  const complete = failedRanges.length === 0 && !anyTruncated && totalProcessedPages >= args.pageCount;

  const capture = {
    ...(aggregated.capture as Record<string, unknown> | undefined),
    coverage: {
      pagesTotal: args.pageCount,
      pagesProcessed: totalProcessedPages,
      pagesFailed: args.pageCount - totalProcessedPages,
      complete,
      note: failedRanges.length > 0
        ? `Batches ${[...failures, ...failedRanges].join(", ")} failed or were omitted; the document is incomplete.`
        : anyTruncated
          ? "One or more provider responses were truncated; the document may be incomplete."
          : undefined,
    },
  };

  const result: ExtractionResult = {
    ...(aggregated as Partial<ExtractionResult>),
    capture,
  } as ExtractionResult;

  return {
    ok: true,
    data: result,
    meta: { provider: args.provider.id, model: "batched", demo: false, durationMs: 0 },
  };
}

export async function processInvoice(args: {
  invoiceId: string;
  userId: string;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  provider: ExtractionProvider;
  config: AiConfig;
}): Promise<ProcessResult> {
  const { invoiceId, userId, db, storage, provider, config } = args;

  const invoice = await db.getOwnedInvoice(invoiceId, userId);
  if (!invoice) {
    return { outcome: "conflict", status: 404, message: "Invoice not found." };
  }

  const eligible = invoice.status === "uploaded" || invoice.status === "failed";
  const staleProcessing =
    invoice.status === "processing" &&
    Date.now() - new Date(invoice.updated_at).getTime() > STALE_CLAIM_MS;
  if (!eligible && !staleProcessing) {
    return {
      outcome: "conflict",
      status: 409,
      message: "This invoice is not available for processing (already processed or currently processing).",
    };
  }

  const active = await db.countActiveProcessing(userId);
  if (active >= config.maxConcurrentProcessing) {
    return {
      outcome: "conflict",
      status: 429,
      message: `Too many invoices are processing at once (limit ${config.maxConcurrentProcessing}). Try again shortly.`,
    };
  }

  const claimed = await db.claimForProcessing(invoiceId, userId);
  if (!claimed) {
    return { outcome: "conflict", status: 409, message: "Another request is already processing this invoice." };
  }

  // The claim succeeded — everything below belongs to this worker.
  // Audit events are best-effort: they must never flip a successfully persisted
  // result into a failure (or vice-versa).
  const tryEvent = async (event: InvoiceEventInput) => {
    try {
      await db.recordEvent(event);
    } catch {
      // non-fatal
    }
  };
  const fail = async (errorInfo: Record<string, unknown>): Promise<ProcessResult> => {
    try {
      await db.markFailed(invoiceId, userId, errorInfo);
      await db.recordEvent({
        invoiceId,
        actor: userId,
        eventType: "processing_failed",
        metadata: { code: errorInfo.code },
      });
    } catch {
      // Log failure to persist should not crash the response.
    }
    const httpStatus =
      typeof errorInfo.httpStatus === "number" ? errorInfo.httpStatus : 502;
    return {
      outcome: "error",
      status: httpStatus,
      message: String(errorInfo.message ?? "Processing failed."),
    };
  };

  try {
    const exists = await storage.objectExists(invoice.storage_path);
    if (!exists) {
      return await fail({ code: "FILE_MISSING", message: "The uploaded file could not be found in storage.", httpStatus: 410 });
    }

    const bytes = await storage.download(invoice.storage_path);

    let validated;
    try {
      validated = await validateUploadedFile({
        bytes,
        filename: invoice.original_filename,
        declaredMimeType: invoice.mime_type,
        maxPdfPages: config.maxPdfPages,
      });
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code?: string }).code) : "INVALID_FILE";
      return await fail({ code, message: err instanceof Error ? err.message : "Invalid file.", httpStatus: 422 });
    }

    const fileHash = sha256Hex(validated.bytes);

    const ranged = (provider as Partial<PageRangedProvider>).extractRange;
    const isBatchedPdf =
      validated.actualMimeType === "application/pdf" &&
      typeof ranged === "function" &&
      (validated.pageCount ?? 1) > BATCH_PAGE_SIZE;

    const outcome: ExtractionOutcome = isBatchedPdf
      ? await extractPagesInBatches({ invoiceId, userId, db, storage, provider, input: { bytes: validated.bytes, mimeType: validated.actualMimeType, pageCount: validated.pageCount }, pageCount: validated.pageCount ?? 1 })
      : await provider.extract({
          bytes: validated.bytes,
          mimeType: validated.actualMimeType,
          pageCount: validated.pageCount ?? undefined,
        });

    if (!outcome.ok) {
      return await fail({ code: outcome.error.code, message: outcome.error.message, httpStatus: 502 });
    }

    const extraction = outcome.data;
    const findings = [
      ...validateExtraction(extraction),
      ...captureCoverageFindings(extraction),
      ...materialConflictFindings(extraction),
    ];
    const keys = deriveDuplicateKeys(extraction);
    const existing = await db.fetchExistingForDuplicates(userId, invoiceId);
    const duplicateFlags = detectDuplicates({
      fileHash,
      supplierKey: keys.supplierKey,
      invoiceNumberKey: keys.invoiceNumberKey,
      existing,
    });

    await db.saveExtraction(invoiceId, {
      fileSha256: fileHash,
      extractedData: toStoredExtraction(extraction),
      findings,
      duplicateFlags,
      extractionMeta: {
        ...outcome.meta,
        provider: outcome.meta.provider,
        model: outcome.meta.model,
        demo: outcome.meta.demo,
      },
    });
    await db.insertLineItems(invoiceId, extraction.lineItems ?? []);
    await tryEvent({
      invoiceId,
      actor: userId,
      eventType: "processing_succeeded",
      after: { status: "needs_review", findings: findings.length, duplicates: Object.keys(duplicateFlags) },
      metadata: { provider: outcome.meta.provider, demo: outcome.meta.demo, hasErrorFindings: hasErrorFindings(findings) },
    });
    await tryEvent({
      invoiceId,
      actor: userId,
      eventType: "needs_review",
      after: { status: "needs_review" },
    });

    return { outcome: "success", invoiceId };
  } catch {
    return await fail({
      code: "PROCESSING_ERROR",
      message: "Processing could not be completed.",
      httpStatus: 500,
    });
  }
}
