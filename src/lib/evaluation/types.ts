import type { ExtractionResult } from "@/lib/pipeline/schema";

/** Field groups the evaluation compares. */
export type ComparisonGroup = "header" | "lineItems" | "taxes" | "fees" | "discounts";

export type FieldStatus = "match" | "mismatch" | "missing" | "invented";

export interface FieldComparison {
  group: ComparisonGroup;
  key: string;
  label: string;
  /** One-based collection row, when the field belongs to a repeated group. */
  index?: number;
  expected: string | null;
  actual: string | null;
  status: FieldStatus;
}

/** Repeated groups can only be compared positionally when their sizes agree. */
export interface StructureMismatch {
  group: "lineItems" | "taxes" | "fees" | "discounts";
  label: string;
  expectedCount: number;
  actualCount: number;
}

export interface ValidationSummary {
  schemaOk: boolean;
  errors: number;
  warnings: number;
  infos: number;
  errorCodes: string[];
  coverageComplete: boolean | null;
}

export interface SampleComparison {
  fields: FieldComparison[];
  structure: StructureMismatch[];
  /** Expected values that were compared (match + mismatch + missing). */
  compared: number;
  matches: number;
  mismatches: number;
  missing: number;
  /** Values returned where the sample expected none. */
  invented: number;
  accuracy: number | null;
  missingLabels: string[];
  mismatchLabels: string[];
  inventedLabels: string[];
  validation: ValidationSummary;
}

export interface SampleRun {
  sampleId: string;
  sampleName: string;
  ok: boolean;
  provider: string;
  model?: string;
  demo: boolean;
  durationMs: number;
  comparison?: SampleComparison;
  error?: { code: string; message: string };
}

export interface EvaluationSummary {
  samples: number;
  completed: number;
  failed: number;
  compared: number;
  matches: number;
  mismatches: number;
  missing: number;
  invented: number;
  accuracy: number | null;
}

export interface EvaluationRun {
  label: string;
  provider: string;
  model?: string;
  demo: boolean;
  runs: SampleRun[];
  summary: EvaluationSummary;
}

/** A synthetic invoice with known ground truth, rendered to PDF on demand. */
export interface SyntheticSample {
  id: string;
  name: string;
  description: string;
  expected: ExtractionResult;
  makeBytes: () => Promise<Uint8Array>;
}
