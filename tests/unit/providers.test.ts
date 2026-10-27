import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@/lib/providers/mock";
import { GeminiProvider } from "@/lib/providers/gemini";
import { GroqProvider } from "@/lib/providers/groq";
import { createProvider } from "@/lib/providers";

const geminiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiMocks.generateContent };
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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  vi.clearAllMocks();
  geminiMocks.generateContent.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("providers", () => {
  it("mock provider returns deterministic demo extraction", async () => {
    const provider = new MockProvider();
    expect(provider.demo).toBe(true);
    const outcome = await provider.extract({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.meta.demo).toBe(true);
      expect(outcome.data.supplierName).toBe("Acme Supplies Ltd");
    }
  });

  it("factory returns mock provider when AI_PROVIDER=mock", () => {
    process.env.AI_PROVIDER = "mock";
    expect(createProvider()).toBeInstanceOf(MockProvider);
  });

  it("factory returns Gemini provider when configured", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    expect(createProvider()).toBeInstanceOf(GeminiProvider);
  });

  it("factory throws when Gemini is selected without a key", () => {
    process.env.AI_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    expect(() => createProvider()).toThrow(/GEMINI_API_KEY/);
  });

  it("factory returns Groq provider when configured", () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GROQ_MODEL = "qwen/qwen3.8-27b";
    expect(createProvider()).toBeInstanceOf(GroqProvider);
  });

  it("factory throws when Groq is selected without a key", () => {
    process.env.AI_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;
    expect(() => createProvider()).toThrow(/GROQ_API_KEY/);
  });

  it("factory does not require Groq key when Gemini is selected", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GROQ_API_KEY;
    expect(createProvider()).toBeInstanceOf(GeminiProvider);
  });

  it("factory throws on unknown provider (rejected by env schema)", () => {
    process.env.AI_PROVIDER = "mystery";
    expect(() => createProvider()).toThrow(/AI_PROVIDER/);
  });

  describe("GeminiProvider retries", () => {
    function gemini(opts?: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number }) {
      return new GeminiProvider("test-key", "gemini-3.8-flash", {
        timeoutMs: 1000,
        retry: { maxRetries: 1, baseDelayMs: 1, ...opts },
      });
    }

    function resolveOk() {
      return { text: VALID_EXTRACTION_JSON, usageMetadata: undefined };
    }

    it("retries a transient timeout and then succeeds", async () => {
      geminiMocks.generateContent
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(resolveOk());
      const outcome = await gemini({ maxRetries: 2 }).extract({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
      });
      expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
      expect(geminiMocks.generateContent).toHaveBeenCalledTimes(3);
    });

    it("normalizes provider alias output into the canonical model", async () => {
      const aliasJson = JSON.stringify({
        vendor: { name: "Acme KG" },
        customer: { name: "Muster GmbH" },
        invoice_number: "R-2026-55",
        invoice_date: "2026-04-01",
        due_date: "2026-05-01",
        amount_due: "55.00",
        line_items: [{ description: "Beratung", qty: 1, unit_price: 55, line_total: 55 }],
        capture: {
          coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
        },
      });
      geminiMocks.generateContent.mockResolvedValueOnce({ text: aliasJson, usageMetadata: undefined });
      const outcome = await gemini({ maxRetries: 0 }).extract({
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf",
      });
      expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
      if (outcome.ok) {
        expect(outcome.data.supplierName).toBe("Acme KG");
        expect(outcome.data.invoiceNumber).toBe("R-2026-55");
        expect(outcome.data.invoiceDate).toBe("2026-04-01");
        expect(outcome.data.balanceDue).toBe("55.00");
        expect(outcome.data.buyer).toMatchObject({ name: "Muster GmbH" });
        expect(outcome.data.capture?.coverage).toMatchObject({ complete: true });
      }
    });

    it("gives up after bounded retries on persistent timeout", async () => {
      geminiMocks.generateContent.mockRejectedValue(new Error("timeout"));
      const outcome = await gemini().extract({
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf",
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("timeout");
        expect(outcome.error.message).toBe("Gemini request timed out.");
      }
      expect(geminiMocks.generateContent).toHaveBeenCalledTimes(2);
    });

    it("does not retry non-transient errors", async () => {
      geminiMocks.generateContent.mockRejectedValue(new Error("API key not valid"));
      const outcome = await gemini().extract({
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf",
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("not_configured");
      }
      expect(geminiMocks.generateContent).toHaveBeenCalledTimes(1);
    });
  });
});
