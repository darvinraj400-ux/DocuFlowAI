import type { ExtractionResult } from "@/lib/pipeline/schema";

/**
 * Merges extracted data with user-reviewed data for display and persistence.
 *
 * - `extracted_data` is never modified and remains the raw source of truth.
 * - `reviewed_data` is the explicit user-edit authority: any key present in
 *   the reviewed value (including an intentional null clear) overrides the
 *   extracted value.
 * - Universal fields absent from older legacy reviewed records fall back to
 *   the extracted values, so capture, evidence, additional fields, shipping,
 *   taxes, parties, etc. survive reopen.
 */
export function mergeExtractionForReview(
  extracted: Partial<ExtractionResult> | null | undefined,
  reviewed: Partial<ExtractionResult> | null | undefined,
): Partial<ExtractionResult> {
  const base: Partial<ExtractionResult> = extracted ? { ...extracted } : {};
  if (!reviewed) return base;

  for (const [key, value] of Object.entries(reviewed)) {
    if (value === undefined) continue;
    if (key === "additional_fields" && (!value || Object.keys(value as object).length === 0)) {
      // empty placeholder from a legacy/plain form must not erase extracted extras
      continue;
    }
    (base as Record<string, unknown>)[key] = value;
  }
  return base;
}
