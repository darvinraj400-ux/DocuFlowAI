import type { InvoiceStatus } from "@/types/invoice";

export type InvoicePhase =
  | "queued"
  | "processing"
  | "needs_review"
  | "approved"
  | "rejected"
  | "failed";

export interface InvoiceProgress {
  invoiceId: string;
  status: InvoiceStatus;
  phase: InvoicePhase;
  terminal: boolean;
  batchesTotal: number | null;
  batchesCompleted: number;
  pagesTotal: number | null;
  pagesProcessed: number;
  message: string | null;
  updatedAt: string | null;
}

export interface InvoiceProgressRow {
  id: string;
  status: InvoiceStatus;
  updated_at?: string | null;
  extraction_meta?: unknown;
  error_info?: unknown;
}

const TERMINAL_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  "needs_review",
  "approved",
  "rejected",
  "failed",
]);

export const POLL_DELAYS_MS = [1500, 2000, 3000, 5000] as const;

/** Caps polling so an abandoned job cannot keep a tab polling forever. */
export const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export function isTerminalStatus(status: InvoiceStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function nextPollDelayMs(attempt: number): number {
  const index = Math.min(Math.max(0, Math.floor(attempt)), POLL_DELAYS_MS.length - 1);
  return POLL_DELAYS_MS[index];
}

export type PollAction =
  | { kind: "stop"; reason: "unauthorized" | "terminal" | "expired" }
  | { kind: "continue"; attempt: number; delayMs: number };

/**
 * Single decision point for UI polling: stop on lost access, terminal states,
 * or the overall duration cap; otherwise continue with capped backoff.
 */
export function nextPollAction(input: {
  attempt: number;
  elapsedMs: number;
  httpStatus?: number | null;
  terminal?: boolean;
}): PollAction {
  if (input.httpStatus === 401 || input.httpStatus === 404) {
    return { kind: "stop", reason: "unauthorized" };
  }
  if (input.terminal === true) {
    return { kind: "stop", reason: "terminal" };
  }
  if (input.elapsedMs > MAX_POLL_DURATION_MS) {
    return { kind: "stop", reason: "expired" };
  }
  const attempt = Math.max(0, Math.floor(input.attempt)) + 1;
  return { kind: "continue", attempt, delayMs: nextPollDelayMs(attempt) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(errorInfo: unknown): string | null {
  if (!isRecord(errorInfo)) return null;
  const message = errorInfo.message;
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 300)
    : null;
}

/**
 * Derives UI state from persisted status + extraction checkpoints only. No
 * schema additions: queued is `uploaded` because the enqueue route leaves the
 * invoice untouched until a worker atomically claims it.
 */
export function buildInvoiceProgress(row: InvoiceProgressRow): InvoiceProgress {
  const meta = isRecord(row.extraction_meta) ? row.extraction_meta : {};
  const batches = isRecord(meta._batches) ? meta._batches : null;
  const ranges = batches && isRecord(batches.ranges) ? Object.values(batches.ranges) : [];

  const pagesTotal =
    batches && typeof batches.pageCount === "number" ? batches.pageCount : null;
  const batchesTotal =
    batches && typeof batches.totalRanges === "number"
      ? batches.totalRanges
      : ranges.length > 0
        ? ranges.length
        : null;
  const batchesCompleted = ranges.filter(
    (range) => isRecord(range) && range.ok === true,
  ).length;
  const rawProcessed = ranges.reduce<number>((sum, range) => {
    if (isRecord(range) && typeof range.processedPages === "number") {
      return sum + range.processedPages;
    }
    return sum;
  }, 0);
  const pagesProcessed = pagesTotal != null ? Math.min(rawProcessed, pagesTotal) : rawProcessed;

  let message: string | null;
  switch (row.status) {
    case "uploaded":
      message = "Queued — waiting for a processing slot.";
      break;
    case "processing":
      message = batchesTotal != null
        ? `Extracting page batches: ${batchesCompleted} of ${batchesTotal} complete.`
        : "Extraction in progress.";
      break;
    case "failed":
      message = errorMessage(row.error_info) ?? "Processing failed. You can retry.";
      break;
    case "needs_review":
      message = "Extraction finished — ready for review.";
      break;
    default:
      message = null;
  }

  return {
    invoiceId: row.id,
    status: row.status,
    phase: row.status === "uploaded" ? "queued" : row.status,
    terminal: isTerminalStatus(row.status),
    batchesTotal,
    batchesCompleted,
    pagesTotal,
    pagesProcessed,
    message,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}
