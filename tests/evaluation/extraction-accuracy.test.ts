import { describe, expect, it } from "vitest";
import { GeminiProvider } from "@/lib/providers/gemini";
import { MockProvider } from "@/lib/providers/mock";
import { compareExtraction } from "@/lib/evaluation/compare";
import { formatEvaluationJson, formatEvaluationReport } from "@/lib/evaluation/report";
import { runEvaluation } from "@/lib/evaluation/run";
import { ACME_SAMPLE, SYNTHETIC_SAMPLES } from "@/lib/evaluation/samples";
import type { EvaluationRun } from "@/lib/evaluation/types";

/**
 * Reproducible extraction evaluation.
 *
 * Runs synthetic invoices with known expected values against a provider and
 * reports field-level exact-match, missing-field, invented-value, line-item
 * structure, and validation behavior.
 *
 * The mock provider and the comparison self-check run on every test run and are
 * deterministic. Live Gemini runs only when explicitly enabled:
 *
 *   RUN_LIVE_GEMINI_TESTS=true
 *   GEMINI_API_KEY=...
 *   GEMINI_MODEL=...
 *
 * Mock and live results are kept clearly separate; live accuracy is recorded
 * for humans to inspect and is never asserted against a target.
 */

const apiKey = process.env.GEMINI_API_KEY;
const LIVE = process.env.RUN_LIVE_GEMINI_TESTS === "true" && Boolean(apiKey);
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const PRINT_JSON = process.env.EVALUATION_JSON === "true";

function logRun(run: EvaluationRun): void {
  console.log(formatEvaluationReport(run));
  if (PRINT_JSON) console.log(formatEvaluationJson(run));
}

describe("extraction evaluation", () => {
  it("comparison harness agrees with itself for every synthetic sample", () => {
    for (const sample of SYNTHETIC_SAMPLES) {
      const comparison = compareExtraction(sample.expected, sample.expected);
      expect(comparison.validation.schemaOk).toBe(true);
      expect(comparison.validation.errors).toBe(0);
      expect(comparison.accuracy).toBe(1);
      expect(comparison.compared).toBeGreaterThan(0);
      expect(comparison.missing).toBe(0);
      expect(comparison.invented).toBe(0);
      expect(comparison.mismatches).toBe(0);
      expect(comparison.structure).toEqual([]);
    }
  });

  it("mock provider deterministically matches the Acme baseline (offline)", async () => {
    const run = await runEvaluation({
      label: "mock (deterministic, offline)",
      provider: new MockProvider(),
      samples: [ACME_SAMPLE],
    });
    logRun(run);

    const sample = run.runs[0];
    expect(sample.ok).toBe(true);
    expect(sample.demo).toBe(true);
    expect(sample.comparison?.validation.schemaOk).toBe(true);
    expect(sample.comparison?.validation.errors).toBe(0);
    expect(sample.comparison?.validation.warnings).toBe(0);
    expect(sample.comparison?.validation.coverageComplete).toBe(true);

    expect(run.summary.failed).toBe(0);
    expect(run.summary.accuracy).toBe(1);
    expect(run.summary.compared).toBeGreaterThanOrEqual(20);
    expect(run.summary.missing).toBe(0);
    expect(run.summary.invented).toBe(0);
    expect(run.summary.mismatches).toBe(0);

    // Repeated runs must be byte-for-byte stable and produce identical reports.
    const second = await runEvaluation({
      label: "mock (deterministic, offline, repeat)",
      provider: new MockProvider(),
      samples: [ACME_SAMPLE],
    });
    expect(second.runs).toEqual(run.runs);
    expect(second.summary).toEqual(run.summary);
  });

  it("live Gemini results are recorded (opt-in, not asserted for accuracy)", async () => {
    if (!LIVE || !apiKey) {
      console.log("[extraction-eval] live Gemini skipped (RUN_LIVE_GEMINI_TESTS not enabled)");
      return;
    }

    const run = await runEvaluation({
      label: "live gemini (opt-in)",
      provider: new GeminiProvider(apiKey, MODEL),
      samples: SYNTHETIC_SAMPLES,
    });
    logRun(run);

    expect(run.summary.completed).toBe(SYNTHETIC_SAMPLES.length);
    for (const sample of run.runs) {
      expect(sample.ok).toBe(true);
      expect(sample.comparison?.validation.schemaOk).toBe(true);
    }
    // Deliberately no accuracy assertion: live accuracy is observed, not gamed.
  });
});
