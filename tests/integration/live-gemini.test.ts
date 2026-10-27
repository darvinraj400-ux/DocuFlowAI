import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { GeminiProvider } from "@/lib/providers/gemini";

/**
 * Opt-in LIVE Gemini smoke test.
 *
 *   RUN_LIVE_GEMINI_TESTS=true
 *   GEMINI_API_KEY=...
 *   GEMINI_MODEL=... (optional; default gemini-3.8-flash)
 *
 * Uses a synthetic invoice PDF fixture. It prints only execution metadata
 * (duration, token usage) — never raw API responses, credentials, or document
 * contents.
 */
const live = process.env.RUN_LIVE_GEMINI_TESTS === "true" && Boolean(process.env.GEMINI_API_KEY);
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

async function makeSyntheticInvoicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([500, 700]);
  const lines = [
    "Acme Supplies Ltd",
    "Supplier tax id: GB123456789",
    "Invoice: INV-2026-0001",
    "Date: 2026-05-14",
    "Due: 2026-06-13",
    "Currency: GBP",
    "Subtotal: 1000.00",
    "Tax: 200.00",
    "Total: 1200.00",
  ];
  lines.forEach((text, i) => page.drawText(text, { x: 60, y: 640 - i * 24, size: 12, font }));
  return doc.save();
}

describe.skipIf(!live)("live Gemini smoke", () => {
  it("extracts a synthetic invoice and passes schema validation", async () => {
    const bytes = await makeSyntheticInvoicePdf();
    const provider = new GeminiProvider(process.env.GEMINI_API_KEY!, MODEL);
    const outcome = await provider.extract({ bytes, mimeType: "application/pdf" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.meta.provider).toBe("gemini");
    expect(outcome.meta.demo).toBe(false);
    expect(outcome.meta.model).toBe(MODEL);

    expect(outcome.data.supplierName).toBeTruthy();
    expect(outcome.data.invoiceNumber).toBeTruthy();
    expect(outcome.data.invoiceDate).toBeTruthy();
    expect(outcome.data.currencyCode).toBeTruthy();
    expect(outcome.data.total).toBeTruthy();

    const money = /^-?\d+(\.\d{1,4})?$/;
    expect(money.test(outcome.data.total!)).toBe(true);
    if (outcome.data.subtotal) expect(money.test(outcome.data.subtotal)).toBe(true);
    if (outcome.data.taxTotal) expect(money.test(outcome.data.taxTotal)).toBe(true);

    expect(outcome.meta.durationMs).toBeGreaterThanOrEqual(0);
    // Print execution metadata only (no document content, no API payloads).
    console.log(
      `[live-gemini] model=${outcome.meta.model} durationMs=${outcome.meta.durationMs} ` +
        `promptTokens=${outcome.meta.promptTokens} outputTokens=${outcome.meta.outputTokens}`,
    );
  });
});
