import type { ExtractionResult } from "@/lib/pipeline/schema";
import { mergeBatchContributions } from "@/lib/pipeline/reconcile";
import { groundCaptureCoverage } from "@/lib/pipeline/capture";

/** Pages per provider request. Kept small: each batch is one durable Inngest step. */
export const BATCH_PAGE_SIZE = 3;

/** Checkpoint key used when the whole document is extracted in one request. */
export const DOCUMENT_CHECKPOINT_KEY = "document";

export interface PageRange {
  from: number;
  to: number;
}

export interface BatchSnapshotRecord {
  key: string;
  from?: number;
  to?: number;
  ok: boolean;
  processedPages: number;
  truncated?: boolean;
  code?: string;
  message?: string;
  snapshot?: Partial<ExtractionResult>;
}

export function buildBatchRanges(pageCount: number, batchSize: number = BATCH_PAGE_SIZE): PageRange[] {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];
  const size = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : BATCH_PAGE_SIZE;
  const ranges: PageRange[] = [];
  for (let from = 1; from <= pageCount; from += size) {
    ranges.push({ from, to: Math.min(from + size - 1, pageCount) });
  }
  return ranges;
}

export function batchRangeKey(range: PageRange): string {
  return `${range.from}-${range.to}`;
}

function noteMentionsTruncation(record: BatchSnapshotRecord): boolean {
  const note = record.snapshot?.capture?.coverage?.note;
  return typeof note === "string" && note.toLowerCase().includes("truncated");
}

/**
 * Deterministically merges persisted batch snapshots (each keyed by its
 * original page range) into one document-level extraction. Page evidence is
 * merged by original page number, conflicts are preserved, and coverage is
 * grounded in the application's page count rather than model claims.
 */
export function mergeBatchedExtraction(args: {
  pageCount: number;
  records: BatchSnapshotRecord[];
}): ExtractionResult {
  const succeeded = args.records.filter((record) => record.ok && record.snapshot);
  const failed = args.records.filter((record) => !record.ok);

  let aggregated: Partial<ExtractionResult> = {};
  for (const record of succeeded) {
    aggregated = mergeBatchContributions(aggregated, record.snapshot!);
  }

  const rawProcessed = succeeded.reduce((sum, record) => sum + (record.processedPages || 0), 0);
  const pagesProcessed = Math.min(Math.max(0, rawProcessed), args.pageCount);
  const anyTruncated =
    succeeded.some((record) => record.truncated || noteMentionsTruncation(record));
  const complete = failed.length === 0 && !anyTruncated && pagesProcessed >= args.pageCount;

  const priorCoverageNote = aggregated.capture?.coverage?.note;
  const note = failed.length > 0
    ? `Batches ${failed.map((record) => record.key).join(", ")} failed or were omitted; the document is incomplete.`
    : anyTruncated
      ? "One or more provider responses were truncated; the document may be incomplete."
      : typeof priorCoverageNote === "string"
        ? priorCoverageNote
        : undefined;

  const capture = {
    ...(aggregated.capture as Record<string, unknown> | undefined),
    coverage: {
      pagesTotal: args.pageCount,
      pagesProcessed,
      pagesFailed: Math.max(0, args.pageCount - pagesProcessed),
      complete,
      note,
    },
  };

  return {
    ...(aggregated as Partial<ExtractionResult>),
    capture,
  } as ExtractionResult;
}

/**
 * A document extracted in a single provider call cannot be merged per page,
 * but its coverage is still grounded in the page count the app validated.
 */
export function singleDocumentExtraction(
  snapshot: ExtractionResult,
  pageCount: number,
): ExtractionResult {
  const modelProcessed = snapshot.capture?.coverage?.pagesProcessed;
  const capture = groundCaptureCoverage(snapshot.capture, {
    pageCount,
    pagesProcessed: typeof modelProcessed === "number" ? modelProcessed : pageCount,
  });
  return { ...snapshot, capture };
}
