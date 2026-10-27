import { describe, expect, it } from "vitest";
import {
  MAX_POLL_DURATION_MS,
  buildInvoiceProgress,
  isTerminalStatus,
  nextPollAction,
  nextPollDelayMs,
} from "@/lib/invoice-progress";

describe("invoice progress derivation", () => {
  it("maps an uploaded invoice to queued without claiming progress", () => {
    const progress = buildInvoiceProgress({
      id: "inv-1",
      status: "uploaded",
      updated_at: "2026-10-27T10:00:00.000Z",
    });

    expect(progress).toMatchObject({
      invoiceId: "inv-1",
      status: "uploaded",
      phase: "queued",
      terminal: false,
      batchesTotal: null,
      batchesCompleted: 0,
      pagesTotal: null,
      pagesProcessed: 0,
      message: "Queued — waiting for a processing slot.",
      updatedAt: "2026-10-27T10:00:00.000Z",
    });
  });

  it("reports batch progress and caps processed pages at the document total", () => {
    const progress = buildInvoiceProgress({
      id: "inv-1",
      status: "processing",
      updated_at: "2026-10-27T10:00:00.000Z",
      extraction_meta: {
        _batches: {
          fileSha256: "abc",
          pageCount: 8,
          totalRanges: 3,
          ranges: {
            "1-3": { key: "1-3", ok: true, processedPages: 3 },
            "4-6": { key: "4-6", ok: true, processedPages: 3 },
            "7-8": { key: "7-8", ok: true, processedPages: 6 },
          },
        },
      },
    });

    expect(progress).toMatchObject({
      phase: "processing",
      terminal: false,
      batchesTotal: 3,
      batchesCompleted: 3,
      pagesTotal: 8,
      pagesProcessed: 8,
      message: "Extracting page batches: 3 of 3 complete.",
    });
  });

  it("falls back to a neutral processing message before checkpoints exist", () => {
    const progress = buildInvoiceProgress({ id: "inv-1", status: "processing" });

    expect(progress.batchesTotal).toBeNull();
    expect(progress.pagesTotal).toBeNull();
    expect(progress.message).toBe("Extraction in progress.");
  });

  it("uses the persisted failure message, truncated to 300 characters", () => {
    const progress = buildInvoiceProgress({
      id: "inv-1",
      status: "failed",
      error_info: { code: "EXTRACTION_FAILED", message: "x".repeat(400) },
    });

    expect(progress.terminal).toBe(true);
    expect(progress.phase).toBe("failed");
    expect(progress.message).toHaveLength(300);
  });

  it("has a safe failure fallback when no message was persisted", () => {
    const progress = buildInvoiceProgress({ id: "inv-1", status: "failed" });

    expect(progress.message).toBe("Processing failed. You can retry.");
    expect(progress.terminal).toBe(true);
  });

  it("marks reviewable and decided invoices terminal", () => {
    for (const status of ["needs_review", "approved", "rejected"] as const) {
      const progress = buildInvoiceProgress({ id: "inv-1", status });
      expect(progress.terminal).toBe(true);
    }
    expect(buildInvoiceProgress({ id: "inv-1", status: "needs_review" }).message).toBe(
      "Extraction finished — ready for review.",
    );
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalStatus("uploaded")).toBe(false);
    expect(isTerminalStatus("processing")).toBe(false);
    expect(isTerminalStatus("needs_review")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("approved")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
  });
});

describe("polling policy", () => {
  it("backs off with a capped delay", () => {
    expect(nextPollDelayMs(0)).toBe(1500);
    expect(nextPollDelayMs(1)).toBe(2000);
    expect(nextPollDelayMs(2)).toBe(3000);
    expect(nextPollDelayMs(3)).toBe(5000);
    expect(nextPollDelayMs(50)).toBe(5000);
    expect(nextPollDelayMs(-4)).toBe(1500);
  });

  it("continues with the next backoff step while the job is active", () => {
    const action = nextPollAction({ attempt: 0, elapsedMs: 1000, httpStatus: 200, terminal: false });

    expect(action).toEqual({ kind: "continue", attempt: 1, delayMs: 2000 });
  });

  it("stops on terminal server state", () => {
    const action = nextPollAction({
      attempt: 3,
      elapsedMs: 20_000,
      httpStatus: 200,
      terminal: true,
    });

    expect(action).toEqual({ kind: "stop", reason: "terminal" });
  });

  it("stops when access is lost", () => {
    expect(
      nextPollAction({ attempt: 0, elapsedMs: 1000, httpStatus: 401, terminal: false }),
    ).toEqual({ kind: "stop", reason: "unauthorized" });
    expect(
      nextPollAction({ attempt: 0, elapsedMs: 1000, httpStatus: 404, terminal: false }),
    ).toEqual({ kind: "stop", reason: "unauthorized" });
  });

  it("stops after the overall duration cap", () => {
    const action = nextPollAction({
      attempt: 10,
      elapsedMs: MAX_POLL_DURATION_MS + 1,
      httpStatus: 200,
      terminal: false,
    });

    expect(action).toEqual({ kind: "stop", reason: "expired" });
  });

  it("prefers a confirmed terminal state over the duration cap", () => {
    const action = nextPollAction({
      attempt: 10,
      elapsedMs: MAX_POLL_DURATION_MS + 1,
      httpStatus: 200,
      terminal: true,
    });

    expect(action).toEqual({ kind: "stop", reason: "terminal" });
  });

  it("stops a network retry once the duration cap is reached", () => {
    const action = nextPollAction({
      attempt: 2,
      elapsedMs: MAX_POLL_DURATION_MS + 5,
      terminal: false,
    });

    expect(action).toEqual({ kind: "stop", reason: "expired" });
  });
});
