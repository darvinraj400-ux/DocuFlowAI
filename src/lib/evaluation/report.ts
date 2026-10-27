import { formatAccuracy } from "@/lib/accuracy/values";
import type { EvaluationRun } from "@/lib/evaluation/types";

function coverageLabel(complete: boolean | null): string {
  if (complete === null) return "unknown";
  return complete ? "complete" : "partial";
}

/**
 * Human-readable evaluation report. Non-matching fields are listed with their
 * expected and actual values so a live run can be reviewed without fabricating
 * an accuracy target.
 */
export function formatEvaluationReport(run: EvaluationRun): string {
  const header = `[extraction-eval] ${run.label} (provider=${run.provider}${
    run.model ? `, model=${run.model}` : ""
  }${run.demo ? ", demo" : ""})`;
  const lines: string[] = [header];

  for (const sample of run.runs) {
    if (!sample.ok || !sample.comparison) {
      lines.push(
        `  ${sample.sampleId}: FAILED ${sample.error?.code ?? "unknown"}: ${
          sample.error?.message ?? "no error details"
        }`,
      );
      continue;
    }

    const comparison = sample.comparison;
    lines.push(
      `  ${sample.sampleId}: schemaOk=${comparison.validation.schemaOk} ` +
        `accuracy=${formatAccuracy(comparison.accuracy)} (${comparison.matches}/${comparison.compared}) ` +
        `missing=${comparison.missing} invented=${comparison.invented} ` +
        `mismatched=${comparison.mismatches} errors=${comparison.validation.errors} ` +
        `warnings=${comparison.validation.warnings} coverage=${coverageLabel(
          comparison.validation.coverageComplete,
        )}`,
    );

    for (const field of comparison.fields) {
      if (field.status === "match") continue;
      lines.push(
        `    ${field.status}: ${field.label} expected=${field.expected ?? "null"} actual=${
          field.actual ?? "null"
        }`,
      );
    }
    for (const mismatch of comparison.structure) {
      lines.push(
        `    structure: ${mismatch.label} expected ${mismatch.expectedCount} row(s), got ${mismatch.actualCount}`,
      );
    }
  }

  const summary = run.summary;
  lines.push(
    `  summary: ${summary.completed}/${summary.samples} completed, ` +
      `accuracy=${formatAccuracy(summary.accuracy)} (${summary.matches}/${summary.compared}), ` +
      `missing=${summary.missing}, invented=${summary.invented}, ` +
      `mismatched=${summary.mismatches}, failed=${summary.failed}`,
  );

  return lines.join("\n");
}

export function formatEvaluationJson(run: EvaluationRun): string {
  return JSON.stringify(run, null, 2);
}
