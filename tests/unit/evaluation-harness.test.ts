import { describe, expect, it } from "vitest";
import { compareExtraction } from "@/lib/evaluation/compare";
import { formatEvaluationJson, formatEvaluationReport } from "@/lib/evaluation/report";
import { runEvaluation } from "@/lib/evaluation/run";
import { ACME_SAMPLE } from "@/lib/evaluation/samples";
import type { SyntheticSample } from "@/lib/evaluation/types";
import type { ExtractionResult } from "@/lib/pipeline/schema";
import type { ExtractionOutcome, ExtractionProvider } from "@/lib/providers/types";

const REPRESENTATIVE_EXPECTED: ExtractionResult = {
  supplierName: "Acme Ltd",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-01-01",
  currencyCode: "USD",
  total: "100.00",
};

const REPRESENTATIVE_ACTUAL: ExtractionResult = {
  supplierName: "  acme   ltd ",
  invoiceNumber: "INV-2",
  invoiceDate: "2026-01-01",
  currencyCode: "usd",
  total: "100.0",
  dueDate: "2026-02-01",
};

const SMALL_SAMPLE: SyntheticSample = {
  ...ACME_SAMPLE,
  makeBytes: async () => new Uint8Array(),
};

function fixedProvider(data: ExtractionResult): ExtractionProvider {
  return {
    id: "fixture",
    demo: false,
    async extract(): Promise<ExtractionOutcome> {
      return {
        ok: true,
        data,
        meta: { provider: "fixture", demo: false, durationMs: 1 },
      };
    },
  };
}

describe("evaluation harness", () => {
  it("classifies matches, mismatches, missing values, and invented values", () => {
    const compared = compareExtraction(REPRESENTATIVE_EXPECTED, REPRESENTATIVE_ACTUAL);

    expect(compared).toMatchObject({
      compared: 5,
      matches: 4,
      mismatches: 1,
      missing: 0,
      invented: 1,
    });
    expect(compared.accuracy).toBeCloseTo(0.8);
    expect(compared.mismatchLabels).toEqual(["Invoice number"]);
    expect(compared.missingLabels).toEqual([]);
    expect(compared.inventedLabels).toEqual(["Due date"]);
    expect(compared.validation.schemaOk).toBe(true);
    expect(compared.validation.errors).toBe(0);

    const missing = compareExtraction(
      { ...REPRESENTATIVE_EXPECTED, dueDate: "2026-02-01" },
      { ...REPRESENTATIVE_ACTUAL, dueDate: null },
    );
    expect(missing).toMatchObject({ compared: 6, matches: 4, missing: 1, invented: 0 });
    expect(missing.missingLabels).toEqual(["Due date"]);
    expect(missing.accuracy).toBeCloseTo(4 / 6);
  });

  it("excludes repeated groups whose row counts differ and reports the structure", () => {
    const compared = compareExtraction(
      {
        invoiceNumber: "INV-1",
        lineItems: [{ description: "Widget", quantity: "1" }],
      },
      {
        invoiceNumber: "INV-1",
        lineItems: [
          { description: "Widget", quantity: "1" },
          { description: "Extra", quantity: "1" },
        ],
      },
    );

    expect(compared.structure).toEqual([
      {
        group: "lineItems",
        label: "Line items",
        expectedCount: 1,
        actualCount: 2,
      },
    ]);
    expect(compared.fields.map((field) => field.group)).toEqual(["header"]);
    expect(compared).toMatchObject({ compared: 1, matches: 1, invented: 0 });
    expect(compared.accuracy).toBe(1);
  });

  it("compares line items, taxes, and fees with descriptive row labels", () => {
    const compared = compareExtraction(
      {
        invoiceNumber: "INV-1",
        lineItems: [{ description: "Widget", quantity: "1.0", lineTotal: "10.00" }],
        taxes: [{ name: "VAT", rate: "20.00", amount: "2.00" }],
        fees: [{ description: "Service fee", amount: "3.00" }],
      },
      {
        invoiceNumber: "INV-1",
        lineItems: [{ description: "widget", quantity: "1.00", lineTotal: "10.0" }],
        taxes: [{ name: "vat", rate: "20", amount: "2.0" }],
        fees: [{ description: "service   fee", amount: "3" }],
      },
    );

    expect(compared.structure).toEqual([]);
    expect(compared.invented).toBe(0);
    expect(compared.mismatches).toBe(0);
    expect(compared.accuracy).toBe(1);
    expect(compared.fields.map((field) => field.label)).toContain("Line item 1 · Description");
    expect(compared.fields.map((field) => field.label)).toContain("Tax 1 · Tax name");
    expect(compared.fields.map((field) => field.label)).toContain("Fee 1 · Description");
  });

  it("records provider failures and thrown errors without aborting the run", async () => {
    const failing: ExtractionProvider = {
      id: "failing",
      demo: false,
      async extract() {
        return { ok: false, error: { code: "timeout", message: "Provider timed out" } };
      },
    };
    const failingRun = await runEvaluation({
      label: "failure",
      provider: failing,
      samples: [SMALL_SAMPLE],
    });

    expect(failingRun.runs[0]).toMatchObject({
      sampleId: "acme-baseline",
      ok: false,
      provider: "failing",
      error: { code: "timeout", message: "Provider timed out" },
    });
    expect(failingRun.summary).toMatchObject({
      samples: 1,
      completed: 0,
      failed: 1,
      accuracy: null,
    });

    const throwing: ExtractionProvider = {
      id: "throwing",
      demo: false,
      async extract() {
        throw new Error("boom");
      },
    };
    const thrownRun = await runEvaluation({
      label: "exception",
      provider: throwing,
      samples: [SMALL_SAMPLE],
    });

    expect(thrownRun.runs[0]).toMatchObject({
      ok: false,
      provider: "throwing",
      error: { code: "exception", message: "boom" },
    });
    expect(thrownRun.summary.failed).toBe(1);
  });

  it("formats a text report and serializes the complete run as JSON", async () => {
    const run = await runEvaluation({
      label: "fixture run",
      provider: fixedProvider({ ...ACME_SAMPLE.expected, invoiceNumber: "WRONG" }),
      samples: [SMALL_SAMPLE],
    });

    const text = formatEvaluationReport(run);
    expect(text).toContain("[extraction-eval] fixture run");
    expect(text).toContain("acme-baseline:");
    expect(text).toContain(
      "mismatch: Invoice number expected=INV-2026-0001 actual=WRONG",
    );
    expect(text).toContain("accuracy=95.8% (23/24)");
    expect(text).toContain("summary: 1/1 completed");

    const parsed = JSON.parse(formatEvaluationJson(run)) as typeof run;
    expect(parsed).toEqual(run);
  });
});
