import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { MockProvider } from "@/lib/providers/mock";
import { GeminiProvider } from "@/lib/providers/gemini";
import { extractionSchema, type ExtractionResult } from "@/lib/pipeline/schema";
import { validateExtraction } from "@/lib/pipeline/validate";
import type { ExtractionProvider } from "@/lib/providers/types";

/**
 * Reproducible extraction evaluation.
 *
 * Runs a battery of synthetic invoices with known expected values against a
 * provider and reports field-level exact-match, missing-field, and validation
 * behavior. The MOCK provider runs deterministically on every test run (results
 * are stable). Live Gemini runs only when explicitly enabled:
 *
 *   RUN_LIVE_GEMINI_TESTS=true
 *   GEMINI_API_KEY=...
 *   GEMINI_MODEL=...
 *
 * Mock and live results are kept clearly separate; we do not fabricate claims
 * about live accuracy.
 */

const LIVE = process.env.RUN_LIVE_GEMINI_TESTS === "true" && Boolean(process.env.GEMINI_API_KEY);
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

interface Sample {
  name: string;
  expected: ExtractionResult;
  makeBytes: () => Promise<Uint8Array>;
}

async function makeSyntheticInvoicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([500, 700]);
  const lines = [
    "Acme Supplies Ltd",
    "Invoice: INV-2026-0001",
    "Date: 2026-05-14",
    "Currency: GBP",
    "Subtotal: 1000.00",
    "Tax: 200.00",
    "Total: 1200.00",
  ];
  lines.forEach((text, i) => page.drawText(text, { x: 60, y: 640 - i * 24, size: 12, font }));
  return doc.save();
}

const SAMPLES: Sample[] = [
  {
    name: "synthetic-invoice-acme",
    expected: {
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
      lineItems: [],
    },
    makeBytes: makeSyntheticInvoicePdf,
  },
];

interface EvaluationStats {
  sample: string;
  fieldsCompared: number;
  exactMatches: number;
  missingRequired: string[];
  errorFindings: number;
  schemaOk: boolean;
}

function normalize(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function evaluate(sample: Sample, result: ExtractionResult): EvaluationStats {
  const fields = [
    "supplierName",
    "supplierTaxId",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "currencyCode",
    "subtotal",
    "taxTotal",
    "total",
    "paymentTerms",
  ] as const;

  let exactMatches = 0;
  const missingRequired: string[] = [];
  for (const field of fields) {
    const expected = sample.expected[field] ?? null;
    const actual = result[field] ?? null;
    if (expected !== null) {
      if (normalize(actual as string) === normalize(expected as string)) exactMatches += 1;
    } else if (actual !== null) {
      missingRequired.push(field); // expected null but provider invented a value
    }
  }

  const findings = validateExtraction(result);
  const errorFindings = findings.filter((f) => f.severity === "error").length;

  return {
    sample: sample.name,
    fieldsCompared: fields.length,
    exactMatches,
    missingRequired,
    errorFindings,
    schemaOk: extractionSchema.safeParse(result).success,
  };
}

function report(label: string, stats: EvaluationStats[]) {
  console.log(`\n[extraction-eval] ${label}`);
  for (const s of stats) {
    console.log(
      `  ${s.sample}: schemaOk=${s.schemaOk} exact=${s.exactMatches}/${s.fieldsCompared} ` +
        `missing/invented=${s.missingRequired.join(",") || "none"} errorFindings=${s.errorFindings}`,
    );
  }
}

describe("extraction evaluation", () => {
  it("mock provider is deterministic and matches expected values (offline)", async () => {
    const provider: ExtractionProvider = new MockProvider();
    const stats: EvaluationStats[] = [];
    for (const sample of SAMPLES) {
      const outcome = await provider.extract({ bytes: await sample.makeBytes(), mimeType: "application/pdf" });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) stats.push(evaluate(sample, outcome.data));
    }
    report("mock (deterministic, offline)", stats);
    for (const s of stats) {
      expect(s.schemaOk).toBe(true);
      expect(s.exactMatches).toBe(s.fieldsCompared);
      expect(s.errorFindings).toBe(0);
    }
  });

  it("live Gemini results are recorded (opt-in, not asserted for accuracy)", async () => {
    if (!LIVE) {
      console.log("[extraction-eval] live Gemini skipped (RUN_LIVE_GEMINI_TESTS not enabled)");
      expect(true).toBe(true);
      return;
    }
    const provider: ExtractionProvider = new GeminiProvider(process.env.GEMINI_API_KEY!, MODEL);
    const stats: EvaluationStats[] = [];
    for (const sample of SAMPLES) {
      const outcome = await provider.extract({ bytes: await sample.makeBytes(), mimeType: "application/pdf" });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) stats.push(evaluate(sample, outcome.data));
    }
    report("live gemini (opt-in)", stats);
    // We do NOT assert a target accuracy. Status only that the response is
    // schema-valid (it always is — invalid responses are rejected upstream).
    for (const s of stats) expect(s.schemaOk).toBe(true);
  });
});
