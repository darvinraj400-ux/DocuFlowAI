import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { processInvoice } from "@/lib/pipeline/execute";
import type { DatabaseAdapter, StorageAdapter, InvoiceRowMin } from "@/lib/pipeline/execute";
import type { ExtractionOutcome, PageRangedProvider } from "@/lib/providers/types";
import type { AiConfig } from "@/lib/env";
import type { ExtractionResult } from "@/lib/pipeline/schema";

async function makePdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 8; i += 1) {
    doc.addPage([400, 600]);
  }
  return doc.save();
}

function makeInvoice(): InvoiceRowMin {
  return {
    id: "inv-1",
    user_id: "user-1",
    status: "uploaded",
    storage_path: "user-1/inv-1/original.pdf",
    original_filename: "invoice.pdf",
    mime_type: "application/pdf",
    updated_at: new Date().toISOString(),
  };
}

function batchResult(range: { from: number; to: number }, label: string): ExtractionOutcome {
  const pageCount = range.to - range.from + 1;
  return {
    ok: true,
    data: {
      supplierName: label,
      invoiceNumber: "INV-1",
      total: "10.00",
      lineItems: Array.from({ length: pageCount }, (_, i) => ({
        description: `${label}-item-${range.from + i}`,
        quantity: "1",
        unitPrice: "1.00",
        taxAmount: null,
        lineTotal: "1.00",
      })),
      capture: {
        pages: Array.from({ length: pageCount }, (_, i) => ({ page: range.from + i, text: label, extracted: true })),
        coverage: { pagesTotal: pageCount, pagesProcessed: pageCount, pagesFailed: 0, complete: true },
      },
    } as ExtractionResult,
    meta: { provider: "groq", model: "qwen", demo: false, durationMs: 1 },
  };
}

describe("batched page processing", () => {
  let db: DatabaseAdapter & { metaStore: Record<string, unknown> };
  let storage: StorageAdapter;
  let invoice: InvoiceRowMin;
  const config: AiConfig = { provider: "groq", geminiModel: "x", groqModel: "qwen/qwen3.8-27b", maxPdfPages: 10, maxConcurrentProcessing: 3 };

  beforeEach(() => {
    invoice = makeInvoice();
    db = {
      metaStore: {},
      getOwnedInvoice: vi.fn(async () => invoice),
      countActiveProcessing: vi.fn(async () => 0),
      claimForProcessing: vi.fn(async () => true),
      fetchExistingForDuplicates: vi.fn(async () => []),
      saveExtraction: vi.fn(async () => undefined),
      insertLineItems: vi.fn(async () => undefined),
      recordEvent: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      readExtractionMeta: vi.fn(async () =>
        db.metaStore._completed_ranges ? { _completed_ranges: db.metaStore._completed_ranges } : null,
      ),
      writeExtractionMeta: vi.fn(async (_id, meta) => {
        db.metaStore = { ...db.metaStore, ...JSON.parse(JSON.stringify(meta)) };
      }),
    };
    storage = {
      objectExists: vi.fn(async () => true),
      download: vi.fn(async () => makePdfBytes()),
    };
  });

  function makeRangedProvider(handler: (range: { from: number; to: number }) => Promise<ExtractionOutcome>): PageRangedProvider & { extractRangeCalls: string[] } {
    const calls: string[] = [];
    const provider: PageRangedProvider = {
      id: "groq",
      demo: false,
      extract: async (): Promise<ExtractionOutcome> => ({ ok: false, error: { code: "timeout", message: "use ranged" } }),
      extractRange: async (_input, range) => {
        calls.push(`${range.from}-${range.to}`);
        return handler(range);
      },
    };
    return Object.assign(provider, { extractRangeCalls: calls });
  }

  const lastPayload = () =>
    (db.saveExtraction as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as {
      extractedData: {
        lineItems: Array<{ description: string }>;
        capture: {
          pages: Array<{ page: number }>;
          coverage: { pagesTotal: number; pagesProcessed: number; pagesFailed: number; complete: boolean };
        };
      };
      findings: Array<{ code: string }>;
    };

  it("processes every page in batches and merges one invoice", async () => {
    const provider = makeRangedProvider(async (range) => batchResult(range, `B${range.from}`));
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider, config });
    expect(result.outcome, JSON.stringify(result)).toBe("success");
    expect(provider.extractRangeCalls).toEqual(["1-3", "4-6", "7-8"]);
    expect(db.saveExtraction).toHaveBeenCalledTimes(1);
    const payload = lastPayload();
    expect(payload.extractedData.lineItems).toHaveLength(8);
    expect(payload.extractedData.capture.pages.map((p: { page: number }) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(payload.extractedData.capture.coverage).toMatchObject({ pagesTotal: 8, pagesProcessed: 8, pagesFailed: 0, complete: true });
    expect(db.insertLineItems).toHaveBeenCalledTimes(1);
  });

  it("resumes after a transient batch failure without reprocessing done batches", async () => {
    let failRange = "4-6";
    const provider = makeRangedProvider(async (range) => {
      if (`${range.from}-${range.to}` === failRange) {
        return { ok: false, error: { code: "timeout", message: "transient" } };
      }
      return batchResult(range, `B${range.from}`);
    });

    const first = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider, config });
    expect(first.outcome).toBe("success");
    expect(provider.extractRangeCalls).toEqual(["1-3", "4-6", "7-8"]);

    invoice.status = "failed";
    failRange = "";
    const second = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider, config });
    expect(second.outcome).toBe("success");
    expect(provider.extractRangeCalls).toEqual(["1-3", "4-6", "7-8", "4-6"]);

    const payload = lastPayload();
    expect(payload.extractedData.lineItems).toHaveLength(8);
    expect(new Set(payload.extractedData.lineItems.map((l) => l.description)).size).toBe(8);
  });

  it("marks coverage partial when a range fails permanently", async () => {
    const provider = makeRangedProvider(async (range) => {
      if (`${range.from}-${range.to}` === "4-6") {
        return { ok: false, error: { code: "malformed_response", message: "permanent" } };
      }
      return batchResult(range, `B${range.from}`);
    });
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider, config });
    expect(result.outcome).toBe("success");
    const payload = lastPayload();
    expect(payload.extractedData.capture.coverage.complete).toBe(false);
    expect(payload.extractedData.capture.coverage.pagesFailed).toBe(5);
    expect(payload.extractedData.capture.coverage.pagesProcessed).toBe(3);
    expect(payload.findings.some((f) => f.code === "PARTIAL_EXTRACTION")).toBe(true);
  });

  it("truncated responses mark the document incomplete", async () => {
    const provider = makeRangedProvider(async (range) => {
      const outcome = batchResult(range, `B${range.from}`);
      if (outcome.ok) {
        (outcome.data.capture!.coverage as { note?: string }).note = "Provider output was truncated by its output limit";
      }
      return outcome;
    });
    await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider, config });
    const payload = lastPayload();
    expect(payload.extractedData.capture.coverage.complete).toBe(false);
  });
});
