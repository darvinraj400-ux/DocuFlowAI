import { validateUploadedFile } from "@/lib/file-validation";
import { mergeBatchContributions } from "@/lib/pipeline/reconcile";
import { captureCoverageFindings, materialConflictFindings, validateExtraction } from "@/lib/pipeline/validate";
import { toStoredExtraction } from "@/lib/pipeline/normalize";
import type { DatabaseAdapter, StorageAdapter, InvoiceRowMin, ProcessResult } from "@/lib/pipeline/execute";
import type { ExtractionProvider, PageRangedProvider } from "@/lib/providers/types";
import type { AiConfig } from "@/lib/env";
import type { ExtractionResult } from "@/lib/pipeline/schema";

export const BATCH_PAGE_SIZE = 3;

interface BatchRecord {
  from: number;
  to: number;
  processedPages: number;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface Checkpoint {
  records: BatchRecord[];
}

function isTransientCode(code: string): boolean {
  return code === "timeout" || code === "rate_limit" || code === "provider_outage";
}

/**
 * Durable, idempotent multi-batch processing for documents with more pages
 * than a single provider request can take. Progress is checkpointed via
 * `database.readExtractionMeta`/`writeExtractionMeta` so a failed or
 * interrupted run can resume from the next unfinished range without
 * duplicating already-extracted batches. Final persistence happens once.
 */
export async function processInvoiceInBatches(args: {
  invoiceId: string;
  userId: string;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  provider: ExtractionProvider;
  config: AiConfig;
}): Promise<ProcessResult> {
  const { invoiceId, userId, db, storage, provider, config } = args;

  const invoice: InvoiceRowMin | null = await db.getOwnedInvoice(invoiceId, userId);
  if (!invoice) return { outcome: "conflict", status: 404, message: "Invoice not found." };

  const eligible = invoice.status === "uploaded" || invoice.status === "failed";
  const staleProcessing =
    invoice.status === "processing" &&
    Date.now() - new Date(invoice.updated_at).getTime() > 10 * 60 * 1000;
  if (!eligible && !staleProcessing) {
    return {
      outcome: "conflict",
      status: 409,
      message: "This invoice is not available for processing (already processed or currently processing).",
    };
  }

  const active = await db.countActiveProcessing(userId);
  if (active >= config.maxConcurrentProcessing) {
    return { outcome: "conflict", status: 429, message: `Too many invoices are processing at once (limit ${config.maxConcurrentProcessing}). Try again shortly.` };
  }

  const claimed = await db.claimForProcessing(invoiceId, userId);
  if (!claimed) {
    return { outcome: "conflict", status: 409, message: "Another request is already processing this invoice." };
  }

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
      // ignore
    }
    const httpStatus = typeof errorInfo.httpStatus === "number" ? errorInfo.httpStatus : 502;
    return { outcome: "error", status: httpStatus, message: String(errorInfo.message ?? "Processing failed.") };
  };

  let bytes: Uint8Array;
  try {
    bytes = await storage.download(invoice.storage_path);
  } catch {
    return fail({ code: "FILE_MISSING", message: "The uploaded file could not be found in storage.", httpStatus: 410 });
  }

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
    return fail({ code, message: err instanceof Error ? err.message : "Invalid file.", httpStatus: 422 });
  }

  const ranged = (provider as Partial<PageRangedProvider>).extractRange;
  if (validated.actualMimeType !== "application/pdf" || !ranged) {
    const single = await provider.extract({ bytes: validated.bytes, mimeType: validated.actualMimeType, pageCount: validated.pageCount });
    if (!single.ok) {
      return fail({ code: single.error.code, message: single.error.message, httpStatus: 502 });
    }
    const payload = toStoredExtraction(single.data);
    try {
      await db.saveExtraction(invoiceId, {
        fileSha256: String(payload.file_sha256 ?? ""),
        extractedData: payload,
        findings: [],
        duplicateFlags: {},
        extractionMeta: { provider: "single", demo: false },
      });
    } catch {
      return fail({ code: "PROCESSING_ERROR", message: "Processing could not be completed.", httpStatus: 500 });
    }
    return { outcome: "success", invoiceId };
  }

  const pageCount = validated.pageCount ?? 1;
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = 1; from <= pageCount; from += BATCH_PAGE_SIZE) {
    ranges.push({ from, to: Math.min(from + BATCH_PAGE_SIZE - 1, pageCount) });
  }

  // checkpoint persist
  let meta: Checkpoint | null = null;
  try {
    const raw = db.readExtractionMeta ? await db.readExtractionMeta(invoiceId) : null;
    if (raw && Array.isArray((raw as Record<string, unknown>)._completed_ranges)) {
      meta = { records: (raw as Record<string, unknown>)._completed_ranges as BatchRecord[] };
    }
  } catch {
    meta = null;
  }
  if (!meta) meta = { records: [] };
  const doneRanges = new Set(meta.records.filter((r) => r.ok).map((r) => `${r.from}-${r.to}`));

  let aggregated: Partial<ExtractionResult> = {};
  let anyTruncated = false;
  const failures: BatchRecord[] = [];

  for (const range of ranges) {
    const key = `${range.from}-${range.to}`;
    if (doneRanges.has(key)) continue;

    const outcome = await ranged.call(provider, { bytes: validated.bytes, mimeType: validated.actualMimeType, pageCount }, range);
    const record: BatchRecord = { from: range.from, to: range.to, processedPages: 0, ok: false };

    if (!outcome.ok) {
      record.errorCode = outcome.error.code;
      record.errorMessage = outcome.error.message;
      record.ok = false;
      failures.push(record);
      meta.records.push(record);
      try {
        if (db.writeExtractionMeta) {
          await db.writeExtractionMeta(invoiceId, { _completed_ranges: meta.records });
        }
      } catch {
        // meta persistence failure is non-fatal at this point
      }
      if (!isTransientCode(outcome.error.code)) {
        // permanent provider error: stop, keep partial progress persisted
        break;
      }
      continue;
    }

    const merged = mergeBatchContributions(aggregated, outcome.data);
    aggregated = merged;
    record.processedPages = outcome.data.capture?.pages?.length ?? 0;
    record.ok = true;
    meta.records.push(record);
    const cov = outcome.data.capture?.coverage;
    if (String(cov?.note ?? "").toLowerCase().includes("truncated")) anyTruncated = true;
    try {
      if (db.writeExtractionMeta) {
        await db.writeExtractionMeta(invoiceId, { _completed_ranges: meta.records });
      }
    } catch {
      // continue; final persistence is the source of truth
    }
  }

  const failedRanges = meta.records.filter((r) => !r.ok).map((r) => `${r.from}-${r.to}`);
  const okRanges = meta.records.filter((r) => r.ok).length;
  const totalProcessedPages = meta.records.filter((r) => r.ok).reduce((sum, r) => sum + r.processedPages, 0);

  if (Object.keys(aggregated).length === 0 && meta.records.length === 0) {
    return fail({ code: "PROCESSING_ERROR", message: "No extraction batch produced a result.", httpStatus: 500 });
  }
  void failures;

  // final document-level normalization (single invoice)
  const reconciled: ExtractionResult = {
    ...(aggregated as Partial<ExtractionResult>),
    capture: {
      ...(aggregated.capture as Record<string, unknown> | undefined),
      coverage: {
        pagesTotal: pageCount,
        pagesProcessed: totalProcessedPages,
        pagesFailed: pageCount - totalProcessedPages,
        complete: failedRanges.length === 0 && !anyTruncated && totalProcessedPages >= pageCount,
        note: failedRanges.length > 0
          ? `Batches ${failedRanges.join(", ")} failed or were omitted; the document is incomplete and should be reviewed/retried.`
          : anyTruncated
            ? "One or more provider responses were truncated; the document may be incomplete."
            : undefined,
      },
    } as never,
  } as ExtractionResult;

  const findings = [
    ...validateExtraction(reconciled),
    ...captureCoverageFindings(reconciled),
    ...materialConflictFindings(reconciled),
  ];

  try {
    const payload = toStoredExtraction(reconciled);
    await db.saveExtraction(invoiceId, {
      fileSha256: String(payload.file_sha256 ?? ""),
      extractedData: payload,
      findings,
      duplicateFlags: {},
      extractionMeta: {
        provider: provider.id,
        batched: true,
        pageCount,
        completedRanges: okRanges,
        failedRanges,
        truncated: anyTruncated,
      },
    });
    await db.insertLineItems(invoiceId, reconciled.lineItems ?? []);
    await db.recordEvent({
      invoiceId,
      actor: userId,
      eventType: "processing_succeeded",
      metadata: { batched: true, okRanges, failedRanges },
    });
  } catch {
    return fail({ code: "PROCESSING_ERROR", message: "Processing could not be completed.", httpStatus: 500 });
  }

  if (failedRanges.length > 0) {
    // Incomplete but partial result: keep invoice open for review with
    // explicit warnings; the meta checkpoint allows a resumable retry.
    return { outcome: "success", invoiceId };
  }
  return { outcome: "success", invoiceId };
}
