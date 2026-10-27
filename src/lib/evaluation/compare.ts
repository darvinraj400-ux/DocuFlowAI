import {
  AMOUNT_ENTRY_FIELD_SPECS,
  HEADER_FIELD_SPECS,
  LINE_ITEM_FIELD_SPECS,
  TAX_FIELD_SPECS,
  type FieldSpec,
} from "@/lib/accuracy/fields";
import { accuracyOf, readComparableValue, valuesMatch } from "@/lib/accuracy/values";
import type { ExtractionResult } from "@/lib/pipeline/schema";
import { extractionSchema } from "@/lib/pipeline/schema";
import {
  captureCoverageFindings,
  materialConflictFindings,
  validateExtraction,
} from "@/lib/pipeline/validate";
import type {
  ComparisonGroup,
  FieldComparison,
  SampleComparison,
  StructureMismatch,
} from "@/lib/evaluation/types";

interface RowPosition {
  index: number;
  label: string;
}

function compareField(
  group: ComparisonGroup,
  spec: FieldSpec<string>,
  expected: unknown,
  actual: unknown,
  row?: RowPosition,
): FieldComparison | null {
  const before = readComparableValue(expected);
  const after = readComparableValue(actual);
  if (before === null && after === null) return null;

  let status: FieldComparison["status"];
  if (before === null) status = "invented";
  else if (after === null) status = "missing";
  else status = valuesMatch(before, after, spec.kind) ? "match" : "mismatch";

  return {
    group,
    key: spec.key,
    label: row == null ? spec.label : `${row.label} ${row.index + 1} · ${spec.label}`,
    ...(row == null ? {} : { index: row.index }),
    expected: before,
    actual: after,
    status,
  };
}

function compareRecordFields(
  group: ComparisonGroup,
  specs: readonly FieldSpec<string>[],
  expected: Record<string, unknown> | null,
  actual: Record<string, unknown> | null,
  row?: RowPosition,
): FieldComparison[] {
  const fields: FieldComparison[] = [];
  for (const spec of specs) {
    const comparison = compareField(group, spec, expected?.[spec.key], actual?.[spec.key], row);
    if (comparison) fields.push(comparison);
  }
  return fields;
}

function compareCollection(
  group: "lineItems" | "taxes" | "fees" | "discounts",
  label: string,
  rowLabel: string,
  specs: readonly FieldSpec<string>[],
  expected: unknown,
  actual: unknown,
): { fields: FieldComparison[]; structure: StructureMismatch | null } {
  const expectedRows = Array.isArray(expected) ? expected : [];
  const actualRows = Array.isArray(actual) ? actual : [];

  if (expectedRows.length !== actualRows.length) {
    return {
      fields: [],
      structure:
        expectedRows.length === 0 && actualRows.length === 0
          ? null
          : { group, label, expectedCount: expectedRows.length, actualCount: actualRows.length },
    };
  }

  const fields: FieldComparison[] = [];
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expectedRow =
      typeof expectedRows[index] === "object" && expectedRows[index] !== null
        ? (expectedRows[index] as Record<string, unknown>)
        : null;
    const actualRow =
      typeof actualRows[index] === "object" && actualRows[index] !== null
        ? (actualRows[index] as Record<string, unknown>)
        : null;
    fields.push(
      ...compareRecordFields(group, specs, expectedRow, actualRow, {
        index,
        label: rowLabel,
      }),
    );
  }
  return { fields, structure: null };
}

/**
 * Compares a provider result against a synthetic sample's ground truth.
 *
 * Accuracy counts only values the sample expected (matches / the sum of
 * matches, mismatches, and missing values). Values the provider invented for
 * fields the sample left empty are reported separately so they cannot inflate
 * or dilute accuracy. Repeated groups are compared positionally only when
 * both sides have the same row count; otherwise the structure mismatch is
 * reported and those fields are excluded.
 */
export function compareExtraction(
  expected: ExtractionResult,
  actual: ExtractionResult,
): SampleComparison {
  const fields: FieldComparison[] = [];
  const structure: StructureMismatch[] = [];

  fields.push(...compareRecordFields("header", HEADER_FIELD_SPECS, expected, actual));

  for (const collection of [
    {
      group: "lineItems" as const,
      label: "Line items",
      rowLabel: "Line item",
      specs: LINE_ITEM_FIELD_SPECS,
      expectedRows: expected.lineItems,
      actualRows: actual.lineItems,
    },
    {
      group: "taxes" as const,
      label: "Tax components",
      rowLabel: "Tax",
      specs: TAX_FIELD_SPECS,
      expectedRows: expected.taxes,
      actualRows: actual.taxes,
    },
    {
      group: "fees" as const,
      label: "Fees",
      rowLabel: "Fee",
      specs: AMOUNT_ENTRY_FIELD_SPECS,
      expectedRows: expected.fees,
      actualRows: actual.fees,
    },
    {
      group: "discounts" as const,
      label: "Discounts",
      rowLabel: "Discount",
      specs: AMOUNT_ENTRY_FIELD_SPECS,
      expectedRows: expected.discounts,
      actualRows: actual.discounts,
    },
  ]) {
    const compared = compareCollection(
      collection.group,
      collection.label,
      collection.rowLabel,
      collection.specs,
      collection.expectedRows,
      collection.actualRows,
    );
    fields.push(...compared.fields);
    if (compared.structure) structure.push(compared.structure);
  }

  const counted = fields.filter((field) => field.status !== "invented");
  const matches = counted.filter((field) => field.status === "match").length;
  const mismatches = counted.filter((field) => field.status === "mismatch").length;
  const missing = counted.filter((field) => field.status === "missing").length;
  const invented = fields.length - counted.length;

  const findings = [
    ...validateExtraction(actual),
    ...captureCoverageFindings(actual),
    ...materialConflictFindings(actual),
  ];
  const errors = findings.filter((finding) => finding.severity === "error");

  return {
    fields,
    structure,
    compared: counted.length,
    matches,
    mismatches,
    missing,
    invented,
    accuracy: accuracyOf(matches, counted.length),
    missingLabels: counted.filter((f) => f.status === "missing").map((f) => f.label),
    mismatchLabels: counted.filter((f) => f.status === "mismatch").map((f) => f.label),
    inventedLabels: fields.filter((f) => f.status === "invented").map((f) => f.label),
    validation: {
      schemaOk: extractionSchema.safeParse(actual).success,
      errors: errors.length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      infos: findings.filter((finding) => finding.severity === "info").length,
      errorCodes: errors.map((finding) => finding.code),
      coverageComplete: actual.capture?.coverage?.complete ?? null,
    },
  };
}
