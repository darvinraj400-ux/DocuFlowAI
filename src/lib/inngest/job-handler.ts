import { NonRetriableError } from "inngest";
import {
  DOCUMENT_CHECKPOINT_KEY,
  batchRangeKey,
  buildBatchRanges,
  type PageRange,
} from "@/lib/pipeline/batch-plan";
import type {
  BatchCheckpoint,
  InvoiceJobStore,
  JobInvoice,
} from "@/lib/inngest/job-store";
import type {
  ExtractionOutcome,
  ExtractionProvider,
  PageRangedProvider,
} from "@/lib/providers/types";
import { parseProcessingEvent } from "@/lib/inngest/events";

/** Provider failures that may succeed on a later attempt. */
const TRANSIENT_PROVIDER_CODES = new Set(["timeout", "rate_limit", "provider_outage"]);

export interface JobDeps {
  store: InvoiceJobStore;
  createProvider: () => ExtractionProvider;
  maxPdfPages: number;
}

export interface JobStepTools {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
}

export interface InvoiceJobContext {
  event: { data: unknown };
  step: JobStepTools;
}

export type JobResult =
  | { status: "completed"; invoiceId: string }
  | { status: "skipped"; invoiceId: string; reason: string }
  | { status: "failed"; invoiceId: string; code: string };

export type InvoiceJobHandler = (ctx: InvoiceJobContext) => Promise<JobResult>;

interface BatchStepSummary {
  key: string;
  ok: boolean;
  processedPages: number;
  code?: string;
  message?: string;
  reused?: boolean;
  superseded?: boolean;
}

function safeMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() ? message.slice(0, 500) : fallback;
}

function isTransient(code: string): boolean {
  return TRANSIENT_PROVIDER_CODES.has(code);
}

function snapshotTruncated(outcome: Extract<ExtractionOutcome, { ok: true }>): boolean {
  const note = outcome.data.capture?.coverage?.note;
  return typeof note === "string" && note.toLowerCase().includes("truncated");
}

async function persistFailure(args: {
  store: InvoiceJobStore;
  invoice: JobInvoice;
  jobId: string;
  fileSha256: string;
  range?: PageRange;
  code: string;
  message: string;
}): Promise<BatchStepSummary> {
  const key = args.range ? batchRangeKey(args.range) : DOCUMENT_CHECKPOINT_KEY;
  const checkpoint: BatchCheckpoint = {
    key,
    from: args.range?.from,
    to: args.range?.to,
    ok: false,
    processedPages: 0,
    code: args.code,
    message: args.message,
    at: new Date().toISOString(),
  };
  const written = await args.store.writeCheckpoint({
    invoiceId: args.invoice.id,
    ownerId: args.invoice.ownerId,
    jobId: args.jobId,
    fileSha256: args.fileSha256,
    checkpoint,
  });
  return { key, ok: false, processedPages: 0, code: args.code, message: args.message, superseded: !written };
}

async function persistSuccess(args: {
  store: InvoiceJobStore;
  invoice: JobInvoice;
  jobId: string;
  fileSha256: string;
  key: string;
  range?: PageRange;
  outcome: Extract<ExtractionOutcome, { ok: true }>;
  processedPages: number;
}): Promise<BatchStepSummary> {
  const checkpoint: BatchCheckpoint = {
    key: args.key,
    from: args.range?.from,
    to: args.range?.to,
    ok: true,
    processedPages: args.processedPages,
    truncated: snapshotTruncated(args.outcome),
    snapshot: args.outcome.data,
    providerMeta: args.outcome.meta,
    at: new Date().toISOString(),
  };
  const written = await args.store.writeCheckpoint({
    invoiceId: args.invoice.id,
    ownerId: args.invoice.ownerId,
    jobId: args.jobId,
    fileSha256: args.fileSha256,
    checkpoint,
  });
  return {
    key: args.key,
    ok: true,
    processedPages: args.processedPages,
    superseded: !written,
  };
}

/** Extracts one original page range. Never called for memoized steps. */
export async function runBatchAttempt(args: {
  store: InvoiceJobStore;
  createProvider: () => ExtractionProvider;
  invoice: JobInvoice;
  jobId: string;
  fileSha256: string;
  mimeType: string;
  pageCount: number;
  range: PageRange;
}): Promise<BatchStepSummary> {
  const key = batchRangeKey(args.range);

  // A checkpoint may already exist from an earlier job on the same file.
  const existing = await args.store.readCheckpoint({
    invoiceId: args.invoice.id,
    ownerId: args.invoice.ownerId,
    fileSha256: args.fileSha256,
    key,
  });
  if (existing?.ok) {
    return { key, ok: true, processedPages: existing.processedPages, reused: true };
  }

  let provider: ExtractionProvider;
  try {
    provider = args.createProvider();
  } catch (err) {
    return persistFailure({
      ...args,
      code: "not_configured",
      message: safeMessage(err, "The AI provider is not configured."),
    });
  }

  const ranged = (provider as Partial<PageRangedProvider>).extractRange;
  if (typeof ranged !== "function") {
    throw new NonRetriableError("The configured provider does not support page batches.");
  }

  const bytes = await args.store.downloadDocument(args.invoice.storagePath);
  const outcome = await ranged.call(
    provider,
    { bytes, mimeType: args.mimeType, pageCount: args.pageCount },
    args.range,
  );

  if (!outcome.ok) {
    if (isTransient(outcome.error.code)) {
      throw new Error(`Provider temporarily unavailable (${outcome.error.code}): ${outcome.error.message}`);
    }
    return persistFailure({
      ...args,
      code: outcome.error.code,
      message: outcome.error.message,
    });
  }

  const processedPages = outcome.data.capture?.pages?.length ?? 0;
  return persistSuccess({
    store: args.store,
    invoice: args.invoice,
    jobId: args.jobId,
    fileSha256: args.fileSha256,
    key,
    range: args.range,
    outcome,
    processedPages,
  });
}

/** Extracts a document that is not split into batches (images, or providers without ranges). */
export async function runDocumentAttempt(args: {
  store: InvoiceJobStore;
  createProvider: () => ExtractionProvider;
  invoice: JobInvoice;
  jobId: string;
  fileSha256: string;
  mimeType: string;
  pageCount: number;
}): Promise<BatchStepSummary> {
  const key = DOCUMENT_CHECKPOINT_KEY;

  const existing = await args.store.readCheckpoint({
    invoiceId: args.invoice.id,
    ownerId: args.invoice.ownerId,
    fileSha256: args.fileSha256,
    key,
  });
  if (existing?.ok) {
    return { key, ok: true, processedPages: existing.processedPages, reused: true };
  }

  let provider: ExtractionProvider;
  try {
    provider = args.createProvider();
  } catch (err) {
    return persistFailure({
      ...args,
      code: "not_configured",
      message: safeMessage(err, "The AI provider is not configured."),
    });
  }

  const bytes = await args.store.downloadDocument(args.invoice.storagePath);
  const outcome = await provider.extract({
    bytes,
    mimeType: args.mimeType,
    pageCount: args.pageCount,
  });

  if (!outcome.ok) {
    if (isTransient(outcome.error.code)) {
      throw new Error(`Provider temporarily unavailable (${outcome.error.code}): ${outcome.error.message}`);
    }
    return persistFailure({
      ...args,
      code: outcome.error.code,
      message: outcome.error.message,
    });
  }

  return persistSuccess({
    store: args.store,
    invoice: args.invoice,
    jobId: args.jobId,
    fileSha256: args.fileSha256,
    key,
    outcome,
    processedPages: args.pageCount,
  });
}

/**
 * Durable orchestration. Each retryable provider batch is its own `step.run`,
 * completed batches are checkpointed in the database, and only the final
 * fenced write transitions the invoice to `needs_review`.
 */
export function createProcessInvoiceHandler(getDeps: () => JobDeps): InvoiceJobHandler {
  return async ({ event, step }) => {
    const parsed = parseProcessingEvent(event.data);
    if (!parsed) throw new NonRetriableError("Invalid invoice processing event payload.");

    const claim = await step.run("claim-invoice", async () => getDeps().store.claimJob(parsed));
    if (!claim.claimed) {
      return { status: "skipped", invoiceId: parsed.invoiceId, reason: claim.reason };
    }
    const invoice = claim.invoice;

    const prepared = await step.run("prepare-document", async () => {
      const deps = getDeps();
      let provider: ExtractionProvider;
      try {
        provider = deps.createProvider();
      } catch (err) {
        return {
          ok: false as const,
          code: "PROVIDER_NOT_CONFIGURED",
          message: safeMessage(err, "The AI provider is not configured."),
        };
      }
      return deps.store.prepareDocument({
        invoice,
        jobId: parsed.jobId,
        maxPdfPages: deps.maxPdfPages,
        provider,
      });
    });

    if (!prepared.ok) {
      if (prepared.superseded) {
        return { status: "skipped", invoiceId: parsed.invoiceId, reason: "superseded" };
      }
      await step.run("mark-failed", async () =>
        getDeps().store.markJobFailed({
          invoiceId: invoice.id,
          ownerId: invoice.ownerId,
          jobId: parsed.jobId,
          errorInfo: { code: prepared.code, message: prepared.message, jobId: parsed.jobId },
        }),
      );
      return { status: "failed", invoiceId: parsed.invoiceId, code: prepared.code };
    }

    const ranges = prepared.batched ? buildBatchRanges(prepared.pageCount) : [];
    const expectedKeys = prepared.batched
      ? ranges.map(batchRangeKey)
      : [DOCUMENT_CHECKPOINT_KEY];

    const summaries: BatchStepSummary[] = [];

    if (prepared.batched) {
      for (const range of ranges) {
        const summary = await step.run(`extract-pages-${range.from}-${range.to}`, async () => {
          const deps = getDeps();
          return runBatchAttempt({
            store: deps.store,
            createProvider: deps.createProvider,
            invoice,
            jobId: parsed.jobId,
            fileSha256: prepared.fileHash,
            mimeType: prepared.mimeType,
            pageCount: prepared.pageCount,
            range,
          });
        });
        summaries.push(summary);
        if (summary.superseded) {
          return { status: "skipped", invoiceId: parsed.invoiceId, reason: "superseded" };
        }
      }
    } else {
      const summary = await step.run("extract-document", async () => {
        const deps = getDeps();
        return runDocumentAttempt({
          store: deps.store,
          createProvider: deps.createProvider,
          invoice,
          jobId: parsed.jobId,
          fileSha256: prepared.fileHash,
          mimeType: prepared.mimeType,
          pageCount: prepared.pageCount,
        });
      });
      summaries.push(summary);
      if (summary.superseded) {
        return { status: "skipped", invoiceId: parsed.invoiceId, reason: "superseded" };
      }
    }

    const failed = summaries.filter((summary) => !summary.ok);
    if (failed.length === summaries.length) {
      const code = failed[0]?.code ?? "EXTRACTION_FAILED";
      await step.run("mark-failed", async () =>
        getDeps().store.markJobFailed({
          invoiceId: invoice.id,
          ownerId: invoice.ownerId,
          jobId: parsed.jobId,
          errorInfo: {
            code,
            message: failed[0]?.message ?? "Extraction failed.",
            failedRanges: failed.map((summary) => summary.key),
            jobId: parsed.jobId,
          },
        }),
      );
      return { status: "failed", invoiceId: parsed.invoiceId, code };
    }

    const finalized = await step.run("finalize-invoice", async () =>
      getDeps().store.finalizeJob({
        invoice,
        jobId: parsed.jobId,
        expectedKeys,
        prepared: {
          fileHash: prepared.fileHash,
          pageCount: prepared.pageCount,
          batched: prepared.batched,
          providerId: prepared.providerId,
          providerDemo: prepared.providerDemo,
        },
      }),
    );

    switch (finalized.outcome) {
      case "saved":
        return { status: "completed", invoiceId: parsed.invoiceId };
      case "skipped":
        return { status: "skipped", invoiceId: parsed.invoiceId, reason: finalized.reason };
      case "all_failed": {
        await step.run("mark-failed", async () =>
          getDeps().store.markJobFailed({
            invoiceId: invoice.id,
            ownerId: invoice.ownerId,
            jobId: parsed.jobId,
            errorInfo: {
              code: "EXTRACTION_FAILED",
              message: finalized.message,
              codes: finalized.codes,
              jobId: parsed.jobId,
            },
          }),
        );
        return { status: "failed", invoiceId: parsed.invoiceId, code: "EXTRACTION_FAILED" };
      }
      case "missing_checkpoints": {
        await step.run("mark-failed", async () =>
          getDeps().store.markJobFailed({
            invoiceId: invoice.id,
            ownerId: invoice.ownerId,
            jobId: parsed.jobId,
            errorInfo: {
              code: "CHECKPOINT_MISSING",
              message: "Completed batch checkpoints were missing; the invoice can be retried.",
              missing: finalized.keys,
              jobId: parsed.jobId,
            },
          }),
        );
        return { status: "failed", invoiceId: parsed.invoiceId, code: "CHECKPOINT_MISSING" };
      }
    }
  };
}
