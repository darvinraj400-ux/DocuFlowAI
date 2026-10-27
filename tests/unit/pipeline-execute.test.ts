import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { processInvoice } from "@/lib/pipeline/execute";
import type { DatabaseAdapter, StorageAdapter, InvoiceRowMin } from "@/lib/pipeline/execute";
import type { ExtractionProvider } from "@/lib/providers/types";
import type { AiConfig } from "@/lib/env";

async function makePdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  return doc.save();
}

function makeInvoice(overrides: Partial<InvoiceRowMin> = {}): InvoiceRowMin {
  return {
    id: "inv-1",
    user_id: "user-1",
    status: "uploaded",
    storage_path: "user-1/inv-1/original.pdf",
    original_filename: "invoice.pdf",
    mime_type: "application/pdf",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

let providerInputs: Array<{ bytes: Uint8Array; mimeType: string; pageCount?: number | null }> = [];

function okProvider(): ExtractionProvider {
  return {
    id: "test",
    demo: false,
    extract: async (input) => {
      providerInputs.push(input);
      return {
        ok: true,
        data: {
          supplierName: "Acme",
          supplierTaxId: null,
          invoiceNumber: "INV-1",
          invoiceDate: "2026-05-14",
          dueDate: null,
          currencyCode: "USD",
          subtotal: "100.00",
          taxTotal: "10.00",
          total: "110.00",
          paymentTerms: null,
          lineItems: [],
          capture: { coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true } },
        },
        meta: { provider: "test", model: "x", demo: false, durationMs: 5 },
      };
    },
  };
}

describe("processing pipeline", () => {
  let db: DatabaseAdapter;
  let storage: StorageAdapter;
  let invoice: InvoiceRowMin;
  const config: AiConfig = { provider: "gemini", geminiModel: "x", groqModel: "qwen/qwen3.8-27b", maxPdfPages: 10, maxConcurrentProcessing: 3 };

  const recordEvent = vi.fn(async () => undefined);

  beforeEach(() => {
    invoice = makeInvoice();
    db = {
      getOwnedInvoice: vi.fn(async () => invoice),
      countActiveProcessing: vi.fn(async () => 0),
      claimForProcessing: vi.fn(async () => true),
      fetchExistingForDuplicates: vi.fn(async () => []),
      saveExtraction: vi.fn(async () => undefined),
      insertLineItems: vi.fn(async () => undefined),
      recordEvent,
      markFailed: vi.fn(async () => undefined),
    };
    storage = {
      objectExists: vi.fn(async () => true),
      download: vi.fn(async () => makePdfBytes()),
    };
    providerInputs = [];
    recordEvent.mockClear();
  });

  it("passes the validated page count to the provider", async () => {
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: okProvider(), config });
    expect(result.outcome).toBe("success");
    expect(providerInputs[0]?.pageCount).toBe(1);
  });

  it("processes a valid invoice into needs_review", async () => {
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: okProvider(), config });
    expect(result.outcome).toBe("success");
    expect(db.saveExtraction).toHaveBeenCalledTimes(1);
    expect(db.insertLineItems).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalled();
  });

  it("persists capture and additional fields into extracted_data", async () => {
    const captureProvider: ExtractionProvider = {
      id: "test",
      demo: false,
      extract: async () => ({
        ok: true,
        data: {
          supplierName: "Acme",
          supplierTaxId: null,
          invoiceNumber: "INV-1",
          invoiceDate: "2026-05-14",
          dueDate: null,
          currencyCode: "USD",
          subtotal: "100.00",
          taxTotal: "10.00",
          total: "110.00",
          paymentTerms: null,
          lineItems: [],
          additional_fields: { custom_attr: "keep" },
          capture: {
            pages: [{ page: 1, text: "Acme" }],
            fullText: "Acme",
            coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
          },
        },
        meta: { provider: "test", model: "x", demo: false, durationMs: 5 },
      }),
    };
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: captureProvider, config });
    expect(result.outcome).toBe("success");
    const payload = (db.saveExtraction as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(payload.extractedData.capture.coverage.complete).toBe(true);
    expect(payload.extractedData.additional_fields.custom_attr).toBe("keep");
  });

  it("returns conflict when the invoice is not eligible", async () => {
    invoice.status = "approved";
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: okProvider(), config });
    expect(result).toMatchObject({ outcome: "conflict", status: 409 });
    expect(db.claimForProcessing).not.toHaveBeenCalled();
  });

  it("returns 429 over the concurrency limit", async () => {
    (db.countActiveProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: okProvider(), config });
    expect(result).toMatchObject({ outcome: "conflict", status: 429 });
  });

  it("marks failed when the file is missing", async () => {
    (storage.objectExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: okProvider(), config });
    expect(result).toMatchObject({ outcome: "error", status: 410 });
    expect(db.markFailed).toHaveBeenCalled();
  });

  it("marks failed when the provider errors", async () => {
    const failingProvider: ExtractionProvider = {
      id: "test",
      demo: false,
      extract: async () => ({ ok: false, error: { code: "rate_limit", message: "boom" } }),
    };
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: failingProvider, config });
    expect(result).toMatchObject({ outcome: "error", status: 502 });
    expect(db.markFailed).toHaveBeenCalledWith(invoice.id, "user-1", expect.objectContaining({ code: "rate_limit" }));
  });

  it("rejects a duplicate claim", async () => {
    (db.claimForProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await processInvoice({ invoiceId: invoice.id, userId: "user-1", db, storage, provider: okProvider(), config });
    expect(result).toMatchObject({ outcome: "conflict", status: 409 });
  });
});
