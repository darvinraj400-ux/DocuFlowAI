import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroqProvider, MAX_IMAGES_PER_REQUEST } from "@/lib/providers/groq";
import { parseExtraction } from "@/lib/pipeline/schema";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  pdfText: vi.fn(),
  pdfScreenshot: vi.fn(),
  pdfPageCount: 1,
  destroyCount: 0,
}));

vi.mock("groq-sdk", () => ({
  default: class {
    chat: { completions: { create: typeof mocks.create } };
    constructor() {
      this.chat = { completions: { create: mocks.create } };
    }
  },
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() {
      const count = mocks.pdfPageCount;
      return { text: await mocks.pdfText(), pages: Array.from({ length: count }, (_, i) => ({ num: i + 1 })), total: count };
    }
    async getScreenshot() {
      return mocks.pdfScreenshot();
    }
    async destroy() {
      mocks.destroyCount += 1;
    }
  },
}));

const VALID_EXTRACTION_JSON = JSON.stringify({
  supplierName: "Acme Supplies Ltd",
  supplierTaxId: "GB123456789",
  invoiceNumber: "INV-2026-0001",
  invoiceDate: "2026-05-14",
  dueDate: "2026-06-13",
  currencyCode: "GBP",
  subtotal: "1000.00",
  taxTotal: "200.00",
  total: "1200.00",
  paymentTerms: "Net 30",
  lineItems: [
    {
      description: "Widget assembly service",
      quantity: "10",
      unitPrice: "100.00",
      taxAmount: null,
      lineTotal: "1000.00",
    },
  ],
});

function okCompletion(content: string, finishReason?: string) {
  return { choices: [{ message: { content }, finish_reason: finishReason ?? "stop" }], usage: { prompt_tokens: 10, completion_tokens: 30 } };
}

function provider(opts?: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number }) {
  return new GroqProvider("test-key", "openai/gpt-oss-20b", {
    timeoutMs: 1000,
    retry: { maxRetries: 1, baseDelayMs: 1, ...opts },
  });
}

function visionProvider(opts?: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number }) {
  return new GroqProvider("test-key", "qwen/qwen3.8-27b", {
    timeoutMs: 1000,
    retry: { maxRetries: 1, baseDelayMs: 1, ...opts },
  });
}

const jpegInput = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg" as const };
const pdfInput = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), mimeType: "application/pdf" as const };

function pageShots(pageNumbers: number[]) {
  return {
    pages: pageNumbers.map((n) => ({
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]),
      dataUrl: "data:image/png;base64,QUJD",
      pageNumber: n,
      width: 100,
      height: 100,
      scale: 1.5,
    })),
    total: pageNumbers.length,
  };
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

describe("GroqProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockReset();
    mocks.pdfText.mockReset();
    mocks.pdfPageCount = 1;
    mocks.pdfScreenshot.mockReset();
    mocks.destroyCount = 0;
    mocks.pdfText.mockResolvedValue(
      "INVOICE\nAcme Supplies Ltd\nINV-2026-0001\nTotal GBP 1200.00\nline items: widget assembly service x10 @100.00\n" +
        "supplier: Acme Supplies Ltd, address: 1 Factory Road, London, payment terms net 30, subtotal 1000.00, tax 200.00, total 1200.00",
    );
    mocks.pdfScreenshot.mockResolvedValue(pageShots([1]));
  });

  it("defaults to qwen/qwen3.8-27b which is multimodal", () => {
    expect(new GroqProvider("k", "qwen/qwen3.8-27b").id).toBe("groq");
    expect(new GroqProvider("k", "qwen/qwen3.8-27b").demo).toBe(false);
  });

  it("extracts from PDF text and requests json_schema structured output", async () => {
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.supplierName).toBe("Acme Supplies Ltd");
      expect(outcome.meta.provider).toBe("groq");
      expect(outcome.meta.model).toBe("openai/gpt-oss-20b");
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [body] = mocks.create.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    const messages = body.messages as Array<{ content: string }>;
    expect(messages.some((m) => typeof m.content === "string" && m.content.includes("Acme Supplies Ltd"))).toBe(true);
  });

  it("rejects image input when the configured model is text-only", async () => {
    const outcome = await provider().extract(jpegInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_input");
      expect(outcome.error.message).toContain("text-only");
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("extracts from an image input using vision content parts and json_object mode when the model is multimodal", async () => {
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await visionProvider().extract(jpegInput);
    expect(outcome.ok).toBe(true);
    const [body] = mocks.create.mock.calls[0] as [Record<string, unknown>, unknown];
    const messages = body.messages as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    const user = messages.find((m) => Array.isArray(m.content))!;
    expect(user.content.some((p) => p.type === "image_url" && p.image_url!.url.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("rejects scanned PDFs with a clear error when the model is text-only and never renders", async () => {
    mocks.pdfText.mockResolvedValue("");
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_input");
      expect(outcome.error.message).toContain("scanned or image-only PDF");
      expect(outcome.error.message).toContain("openai/gpt-oss-20b");
    }
    expect(mocks.pdfScreenshot).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("renders scanned PDF pages to PNG and sends them as image input", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    expect(mocks.pdfScreenshot).toHaveBeenCalledTimes(1);
    const [body] = mocks.create.mock.calls[0] as [Record<string, unknown>, unknown];
    const messages = body.messages as Array<{ content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>;
    const user = messages.find((m) => Array.isArray(m.content))!;
    const imageParts = user.content.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]!.image_url!.url.startsWith(PNG_DATA_URL_PREFIX)).toBe(true);
    expect(user.content.find((p) => p.type === "text")!.text).toContain("first 1 page(s)");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("rendering works even when embedded-image extraction would return zero images", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue(pageShots([1]));
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    expect(mocks.pdfScreenshot).toHaveBeenCalledTimes(1);
  });

  it("renders at most three PNG pages from a longer PDF", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue(pageShots([1, 2, 3]));
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok).toBe(true);
    const [body] = mocks.create.mock.calls[0] as [Record<string, unknown>, unknown];
    const messages = body.messages as Array<{ content: Array<{ type: string }> }>;
    const user = messages.find((m) => Array.isArray(m.content))!;
    expect(user.content.filter((p) => p.type === "image_url").length).toBe(MAX_IMAGES_PER_REQUEST);
  });

  it("returns a clear error when page rendering fails", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockRejectedValue(new Error("invalid PDF structure"));
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_input");
      expect(outcome.error.message).toContain("PDF page rendering failed");
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns a clear error when rendering produces no images", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue({ pages: [], total: 0 });
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_input");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rendered buffers are valid non-empty PNGs", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue({
      pages: [
        {
          data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          dataUrl: "",
          pageNumber: 1,
          width: 10,
          height: 10,
          scale: 1,
        },
      ],
      total: 1,
    });
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    const [body] = mocks.create.mock.calls[0] as [Record<string, unknown>, unknown];
    const messages = body.messages as Array<{ content: Array<{ image_url?: { url: string } }> }>;
    const user = messages.find((m) => Array.isArray(m.content))!;
    const imagePart = user.content.find((p) => p.image_url);
    expect(imagePart?.image_url?.url.startsWith(PNG_DATA_URL_PREFIX)).toBe(true);
  });

  it("does not trust model completeness when the application knows pages were omitted", async () => {
    mocks.pdfPageCount = 3;
    mocks.create.mockResolvedValue(
      okCompletion(
        JSON.stringify({
          supplierName: "A",
          capture: { coverage: { pagesTotal: 3, pagesProcessed: 3, complete: true } },
        }),
      ),
    );
    const outcome = await provider().extract({ ...pdfInput, pageCount: 10 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.capture?.coverage).toMatchObject({
        pagesTotal: 10,
        pagesProcessed: 3,
        pagesFailed: 7,
        complete: false,
      });
      expect(outcome.data.capture?.coverage?.note).toContain("Model reported complete");
    }
  });

  it("reports incomplete coverage for scanned PDFs exceeding the three-image limit", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue(pageShots([1, 2, 3]));
    mocks.create.mockResolvedValue(
      okCompletion(JSON.stringify({ supplierName: "A", capture: { coverage: { pagesTotal: 3, complete: true } } })),
    );
    const outcome = await visionProvider().extract({ ...pdfInput, pageCount: 6 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.capture?.coverage).toMatchObject({
        pagesTotal: 6,
        pagesProcessed: 3,
        pagesFailed: 3,
        complete: false,
      });
      expect(String(outcome.data.capture?.coverage?.note)).toContain("3 not sent");
    }
  });

  it("marks coverage incomplete when the provider output was truncated", async () => {
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON, "length"));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.capture?.coverage?.complete).toBe(false);
      expect(outcome.data.capture?.coverage?.note).toContain("truncated");
    }
  });

  it("rejects rendered images that exceed the Groq 20 MB total limit", async () => {
    mocks.pdfText.mockResolvedValue("");
    const huge = new Uint8Array(28 * 1024 * 1024);
    mocks.pdfScreenshot.mockResolvedValue({
      pages: [{ data: huge, dataUrl: "", pageNumber: 1, width: 10, height: 10, scale: 1 }],
      total: 1,
    });
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_input");
      expect(outcome.error.message).toContain("20 MB");
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("destroys the PDF parser on success and on render failure", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    await visionProvider().extract(pdfInput);
    // one parser for text attempt + one for rendering
    expect(mocks.destroyCount).toBe(2);

    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockRejectedValue(new Error("boom"));
    const outcome = await visionProvider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    expect(mocks.destroyCount).toBe(4);
  });

  it("text PDFs continue to use text extraction and never render", async () => {
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(true);
    expect(mocks.pdfScreenshot).not.toHaveBeenCalled();
  });

  it("normalizes provider alias output into the canonical model", async () => {
    const aliasJson = JSON.stringify({
      vendor: { name: "VendorCo Ltd", tax_id: "VAT123" },
      customer: { name: "BuyerCo AB" },
      invoice_number: "INV-9",
      order_number: "PO-77",
      invoice_date: "2026-02-01",
      due_date: "2026-03-01",
      line_items: [{ description: "Service", qty: 1, unit_price: 100, line_total: 100 }],
      tax: { name: "VAT", amount: 25 },
      amount_due: "125.00",
      payment_details: { method: "Card" },
      capture: {
        pages: [{ page: 1, text: "vendor VendorCo Ltd invoice INV-9", extracted: true }],
        fullText: "vendor VendorCo Ltd invoice INV-9",
        coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
        evidence: { invoiceNumber: { page: 1 } },
      },
    });
    mocks.create.mockResolvedValue(okCompletion(aliasJson));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok) {
      expect(outcome.data.supplierName).toBe("VendorCo Ltd");
      expect(outcome.data.supplierTaxId).toBe("VAT123");
      expect(outcome.data.seller).toMatchObject({ name: "VendorCo Ltd", taxId: "VAT123" });
      expect(outcome.data.buyer).toMatchObject({ name: "BuyerCo AB" });
      expect(outcome.data.invoiceNumber).toBe("INV-9");
      expect(outcome.data.orderNumber).toBe("PO-77");
      expect(outcome.data.invoiceDate).toBe("2026-02-01");
      expect(outcome.data.dueDate).toBe("2026-03-01");
      expect(outcome.data.balanceDue).toBe("125.00");
      expect(outcome.data.taxes?.[0]).toMatchObject({ name: "VAT", amount: "25" });
      expect(outcome.data.paymentDetails).toMatchObject({ method: "Card" });
      expect(outcome.data.lineItems?.[0]).toMatchObject({ description: "Service", quantity: "1", unitPrice: "100", lineTotal: "100" });
      expect(outcome.data.capture?.coverage).toMatchObject({ pagesTotal: 1, complete: true });
      expect(outcome.data.capture?.evidence).toMatchObject({ invoiceNumber: { page: 1 } });
    }
  });

  it("returns malformed_response for invalid JSON", async () => {
    mocks.create.mockResolvedValue(okCompletion("{not json"));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("malformed_response");
  });

  it("returns malformed_response when the output fails schema validation", async () => {
    mocks.create.mockResolvedValue(okCompletion(JSON.stringify({ supplierName: 123 })));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("malformed_response");
      expect(outcome.error.message).toContain("schema validation");
    }
  });

  it("retries a transient abort timeout and then succeeds", async () => {
    mocks.create
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after bounded retries on a persistent timeout", async () => {
    mocks.create.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("timeout");
      expect(outcome.error.message).toBe("Groq request timed out.");
    }
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("maps 429 to rate_limit without retrying when retries are disabled", async () => {
    const err = new Error("rate_limit_exceeded") as Error & { status: number };
    err.status = 429;
    mocks.create.mockRejectedValue(err);
    const outcome = await provider({ maxRetries: 0 }).extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("rate_limit");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("maps upstream 5xx to provider_outage", async () => {
    const err = new Error("upstream exploded") as Error & { status: number };
    err.status = 502;
    mocks.create.mockRejectedValue(err);
    const outcome = await provider({ maxRetries: 0 }).extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("provider_outage");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to not_configured", async () => {
    const err = new Error("Invalid API Key") as Error & { status: number };
    err.status = 401;
    mocks.create.mockRejectedValue(err);
    const outcome = await provider({ maxRetries: 0 }).extract(pdfInput);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("not_configured");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("grounds coverage in application facts and rejects forged model completeness", async () => {
    mocks.pdfPageCount = 3;
    const modelJson = JSON.stringify({
      supplierName: "Acme",
      invoiceNumber: "INV-1",
      total: "10.00",
      capture: { coverage: { pagesTotal: 3, pagesProcessed: 3, pagesFailed: 0, complete: true } },
    });
    mocks.create.mockResolvedValue(okCompletion(modelJson));
    const outcome = await provider().extract({ ...pdfInput, pageCount: 10 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const cov = outcome.data.capture?.coverage;
    expect(cov?.pagesTotal).toBe(10);
    expect(cov?.pagesProcessed).toBe(3);
    expect(cov?.complete).toBe(false);
    expect(String(cov?.note)).toContain("Model reported complete");
  });

  it("reports incomplete coverage when a multi-page scanned PDF exceeds the image limit", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue(pageShots([1, 2, 3]));
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON));
    const outcome = await visionProvider().extract({ ...pdfInput, pageCount: 8 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const cov = outcome.data.capture?.coverage;
    expect(cov?.pagesTotal).toBe(8);
    expect(cov?.pagesProcessed).toBe(3);
    expect(cov?.pagesFailed).toBe(5);
    expect(cov?.complete).toBe(false);
    expect(String(cov?.note)).toContain("5 not sent");
  });

  it("reconciles model capture pages missing page numbers with trusted rendered pages", async () => {
    mocks.pdfText.mockResolvedValue("");
    mocks.pdfScreenshot.mockResolvedValue(pageShots([4, 5, 6]));
    const modelJson = JSON.stringify({
      supplierName: "Acme",
      total: "10.00",
      capture: {
        pages: [
          { text: "four", extracted: true },
          { text: "five", extracted: true },
          { text: "six", extracted: true },
        ],
        coverage: { pagesTotal: 8, pagesProcessed: 3, complete: true },
      },
    });
    mocks.create.mockResolvedValue(okCompletion(modelJson));
    const outcome = await visionProvider().extract({ ...pdfInput, pageCount: 8 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const pages = outcome.data.capture?.pages ?? [];
    expect(pages.map((p) => p.page)).toEqual([4, 5, 6]);
    expect(pages[0]).toMatchObject({ text: "four", extracted: true });
    expect(outcome.data.capture?.coverage).toMatchObject({ pagesTotal: 8, pagesProcessed: 3, complete: false });
    expect(outcome.data.capture?.unassignedPages).toBeUndefined();
  });

  it("accepts page_number and pageNumber aliases in capture pages", () => {
    const r = parseExtraction({
      supplierName: "A",
      capture: {
        pages: [
          { page_number: "2", text: "two" },
          { pageNumber: 3, text: "three" },
          { page: 1, text: "one" },
        ],
      },
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value.capture?.pages?.map((p) => p.page)).toEqual([2, 3, 1]);
  });

  it("records unassigned page entries instead of failing when no trusted pages exist", async () => {
    // text path: no trusted page numbers available to reconcile with
    const modelJson = JSON.stringify({
      supplierName: "Acme",
      total: "10.00",
      capture: { pages: [{ text: "orphan page" }] },
    });
    mocks.create.mockResolvedValue(okCompletion(modelJson));
    const outcome = await provider().extract(pdfInput);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.capture?.pages ?? []).toHaveLength(0);
    expect(outcome.data.capture?.unassignedPages).toHaveLength(1);
    expect(String(outcome.data.capture?.coverage?.note)).toContain("unassigned");
  });

  it("marks completeness false when provider output is truncated by the length limit", async () => {
    mocks.pdfPageCount = 1;
    mocks.create.mockResolvedValue(okCompletion(VALID_EXTRACTION_JSON, "length"));
    const outcome = await provider().extract({ ...pdfInput, pageCount: 1 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const cov = outcome.data.capture?.coverage;
    expect(cov?.complete).toBe(false);
    expect(String(cov?.note)).toContain("truncated");
  });
});
