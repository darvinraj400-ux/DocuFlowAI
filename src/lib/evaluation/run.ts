import { accuracyOf } from "@/lib/accuracy/values";
import { compareExtraction } from "@/lib/evaluation/compare";
import type {
  EvaluationRun,
  EvaluationSummary,
  SampleRun,
  SyntheticSample,
} from "@/lib/evaluation/types";
import type { ExtractionProvider } from "@/lib/providers/types";

function summarize(runs: SampleRun[]): EvaluationSummary {
  let compared = 0;
  let matches = 0;
  let mismatches = 0;
  let missing = 0;
  let invented = 0;
  let completed = 0;

  for (const run of runs) {
    if (!run.ok || !run.comparison) continue;
    completed += 1;
    compared += run.comparison.compared;
    matches += run.comparison.matches;
    mismatches += run.comparison.mismatches;
    missing += run.comparison.missing;
    invented += run.comparison.invented;
  }

  return {
    samples: runs.length,
    completed,
    failed: runs.length - completed,
    compared,
    matches,
    mismatches,
    missing,
    invented,
    accuracy: accuracyOf(matches, compared),
  };
}

export interface RunEvaluationOptions {
  label: string;
  provider: ExtractionProvider;
  samples: readonly SyntheticSample[];
}

/** Runs a provider over the synthetic samples and records every outcome. */
export async function runEvaluation({
  label,
  provider,
  samples,
}: RunEvaluationOptions): Promise<EvaluationRun> {
  const runs: SampleRun[] = [];

  for (const sample of samples) {
    try {
      const outcome = await provider.extract({
        bytes: await sample.makeBytes(),
        mimeType: "application/pdf",
      });

      if (!outcome.ok) {
        runs.push({
          sampleId: sample.id,
          sampleName: sample.name,
          ok: false,
          provider: provider.id,
          demo: provider.demo,
          durationMs: 0,
          error: outcome.error,
        });
        continue;
      }

      runs.push({
        sampleId: sample.id,
        sampleName: sample.name,
        ok: true,
        provider: outcome.meta.provider,
        model: outcome.meta.model,
        demo: outcome.meta.demo,
        durationMs: outcome.meta.durationMs,
        comparison: compareExtraction(sample.expected, outcome.data),
      });
    } catch (error) {
      runs.push({
        sampleId: sample.id,
        sampleName: sample.name,
        ok: false,
        provider: provider.id,
        demo: provider.demo,
        durationMs: 0,
        error: {
          code: "exception",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const summary = summarize(runs);
  const firstCompleted = runs.find((run) => run.ok);

  return {
    label,
    provider: firstCompleted?.provider ?? provider.id,
    ...(firstCompleted?.model ? { model: firstCompleted.model } : {}),
    demo: firstCompleted?.demo ?? provider.demo,
    runs,
    summary,
  };
}
