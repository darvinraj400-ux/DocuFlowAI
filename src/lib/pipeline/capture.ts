import type { ExtractionResult } from "@/lib/pipeline/schema";

export type DocumentCapture = NonNullable<ExtractionResult["capture"]>;

export interface CaptureGrounding {
  /** Total pages in the document as known by the application (validation). */
  pageCount?: number | null;
  /** Number of pages actually sent to / processed by the provider. */
  pagesProcessed?: number;
  /** The provider response was cut off (finish reason = length/max tokens). */
  truncated?: boolean;
}

/**
 * Grounds capture coverage in application facts, never trusting the model
 * alone. The model may claim complete:true, but if the application knows pages
 * were omitted/failed/never sent, coverage is forced to incomplete with an
 * explicit note.
 */
export function groundCaptureCoverage(
  capture: DocumentCapture | null | undefined,
  grounding: CaptureGrounding,
): DocumentCapture {
  const base = capture ?? {};
  const modelCoverage = base.coverage ?? {};

  const appKnowsTotal = grounding.pageCount != null && grounding.pageCount > 0;
  let total = appKnowsTotal ? grounding.pageCount! : (modelCoverage.pagesTotal ?? undefined);
  const processed = grounding.pagesProcessed ?? modelCoverage.pagesProcessed ?? total;
  if (total == null && processed != null) {
    total = processed;
  }
  const totalNum = total ?? 0;
  const processedNum = processed ?? 0;
  const modelFailed = modelCoverage.pagesFailed ?? 0;
  const failed = appKnowsTotal
    ? Math.max(modelFailed, Math.max(0, totalNum - processedNum))
    : modelFailed;

  let complete: boolean;
  const notes: string[] = [];
  if (modelCoverage.note) notes.push(String(modelCoverage.note));

  if (appKnowsTotal) {
    complete = !grounding.truncated && processedNum >= totalNum;
    if (modelCoverage.complete === true && !complete) {
      notes.push(`Model reported complete, but only ${processedNum} of ${totalNum} pages were processed/sent by the application.`);
    }
  } else {
    complete = Boolean(modelCoverage.complete) && !grounding.truncated;
  }

  if (grounding.truncated) {
    complete = false;
    notes.push("Provider output was truncated by its output limit; extraction may be incomplete.");
  }
  if (appKnowsTotal && processedNum < totalNum) {
    notes.push(`${processedNum} of ${totalNum} pages processed; ${totalNum - processedNum} not sent to the provider.`);
  }

  const coverage = {
    pagesTotal: total !== undefined ? total : modelCoverage.pagesTotal,
    pagesProcessed: processed !== undefined ? processed : modelCoverage.pagesProcessed,
    pagesFailed: failed,
    complete,
    note: notes.length > 0 ? notes.join(" ") : modelCoverage.note,
  };

  return {
    ...base,
    pages: base.pages ?? [],
    fullText: base.fullText ?? null,
    sections: base.sections,
    evidence: base.evidence,
    coverage,
  };
}
