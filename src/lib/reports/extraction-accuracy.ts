import {
  HEADER_FIELD_SPECS,
  LINE_ITEM_FIELD_SPECS,
  type FieldSpec,
} from "@/lib/accuracy/fields";
import {
  accuracyOf,
  readComparableValue,
  valuesMatch,
  type ValueKind,
} from "@/lib/accuracy/values";

/**
 * Extraction-accuracy reporting for approved invoices.
 *
 * `reviewed_data` is the human-approved snapshot; `extracted_data` is the AI
 * output. A field is scored only when the reviewed snapshot contains it, so
 * legacy/partial records never fabricate agreement or disagreement. Line-item
 * fields are scored only when both arrays have the same length — structural
 * edits are reported separately instead of being mapped by position.
 */
export const REPORT_INVOICE_LIMIT = 500;

export interface AccuracyInvoiceRow {
  id: string;
  reviewed_at?: string | null;
  extracted_data: unknown;
  reviewed_data: unknown;
}

export interface AccuracyTotals {
  compared: number;
  matches: number;
  corrected: number;
  missed: number;
  cleared: number;
  accuracy: number | null;
}

export interface AccuracyFieldStats extends AccuracyTotals {
  key: string;
  label: string;
  group: "header" | "lineItems";
}

export interface AccuracyInvoice {
  id: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  reviewedAt: string | null;
  compared: number;
  matches: number;
  corrections: number;
  lineItemsStructureChanged: boolean;
}

export interface ExtractionAccuracyReport {
  approvedInvoices: number;
  evaluatedInvoices: number;
  skippedWithoutReviewed: number;
  skippedWithoutComparableFields: number;
  lineItemsStructureChanged: number;
  truncated: boolean;
  limit: number;
  header: AccuracyTotals;
  lineItems: AccuracyTotals;
  totals: AccuracyTotals;
  fields: AccuracyFieldStats[];
  invoices: AccuracyInvoice[];
}

type AnalysisGroup = "header" | "lineItems";
type Outcome = "match" | "corrected" | "missed" | "cleared";

function emptyTotals(): AccuracyTotals {
  return { compared: 0, matches: 0, corrected: 0, missed: 0, cleared: 0, accuracy: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function applyOutcome(target: AccuracyTotals, outcome: Outcome): void {
  target.compared += 1;
  if (outcome === "match") target.matches += 1;
  else if (outcome === "corrected") target.corrected += 1;
  else if (outcome === "missed") target.missed += 1;
  else target.cleared += 1;
}

function finalize(target: AccuracyTotals): void {
  target.accuracy = accuracyOf(target.matches, target.compared);
}

interface FieldStatLookup {
  get(group: AnalysisGroup, key: string): AccuracyFieldStats;
}

function createFieldStats(): { fields: AccuracyFieldStats[]; lookup: FieldStatLookup } {
  const fields: AccuracyFieldStats[] = [];
  const map = new Map<string, AccuracyFieldStats>();

  const add = (group: AnalysisGroup, spec: FieldSpec<string>) => {
    const stat: AccuracyFieldStats = {
      group,
      key: spec.key,
      label: spec.label,
      ...emptyTotals(),
    };
    fields.push(stat);
    map.set(`${group}:${spec.key}`, stat);
  };

  for (const spec of HEADER_FIELD_SPECS) add("header", spec);
  for (const spec of LINE_ITEM_FIELD_SPECS) add("lineItems", spec);

  return {
    fields,
    lookup: {
      get(group, key) {
        const stat = map.get(`${group}:${key}`);
        if (!stat) throw new Error(`Missing accuracy field spec for ${group}:${key}`);
        return stat;
      },
    },
  };
}

function outcomeFor(
  beforeRaw: unknown,
  afterRaw: unknown,
  kind: ValueKind,
): Outcome | null {
  const before = readComparableValue(beforeRaw);
  const after = readComparableValue(afterRaw);
  if (before === null && after === null) return null;
  if (before === null) return "missed";
  if (after === null) return "cleared";
  return valuesMatch(before, after, kind) ? "match" : "corrected";
}

export function buildExtractionAccuracyReport(
  rows: readonly AccuracyInvoiceRow[],
  options: { limit?: number } = {},
): ExtractionAccuracyReport {
  const limit = options.limit ?? REPORT_INVOICE_LIMIT;
  const considered = rows.slice(0, limit);
  const header = emptyTotals();
  const lineItems = emptyTotals();
  const totals = emptyTotals();
  const { fields, lookup } = createFieldStats();
  const invoices: AccuracyInvoice[] = [];

  let skippedWithoutReviewed = 0;
  let skippedWithoutComparableFields = 0;
  let lineItemsStructureChanged = 0;

  for (const row of considered) {
    const extracted = isRecord(row.extracted_data) ? row.extracted_data : null;
    const reviewed = isRecord(row.reviewed_data) ? row.reviewed_data : null;
    if (!reviewed) {
      skippedWithoutReviewed += 1;
      continue;
    }

    let invoiceCompared = 0;
    let invoiceMatches = 0;

    const record = (group: AnalysisGroup, spec: FieldSpec<string>, before: unknown, after: unknown) => {
      const outcome = outcomeFor(before, after, spec.kind);
      if (!outcome) return;
      applyOutcome(totals, outcome);
      applyOutcome(group === "header" ? header : lineItems, outcome);
      applyOutcome(lookup.get(group, spec.key), outcome);
      invoiceCompared += 1;
      if (outcome === "match") invoiceMatches += 1;
    };

    for (const spec of HEADER_FIELD_SPECS) {
      if (!hasOwn(reviewed, spec.key)) continue;
      record("header", spec, extracted?.[spec.key], reviewed[spec.key]);
    }

    let structureChanged = false;
    if (hasOwn(reviewed, "lineItems")) {
      const beforeLines = Array.isArray(extracted?.lineItems) ? extracted.lineItems : [];
      const afterLines = Array.isArray(reviewed.lineItems) ? reviewed.lineItems : [];

      if (beforeLines.length !== afterLines.length) {
        structureChanged = true;
        lineItemsStructureChanged += 1;
      } else {
        for (let index = 0; index < afterLines.length; index += 1) {
          const beforeLine = isRecord(beforeLines[index]) ? beforeLines[index] : null;
          const afterLine = isRecord(afterLines[index]) ? afterLines[index] : null;
          if (!afterLine) continue;
          for (const spec of LINE_ITEM_FIELD_SPECS) {
            if (!hasOwn(afterLine, spec.key)) continue;
            record("lineItems", spec, beforeLine?.[spec.key], afterLine[spec.key]);
          }
        }
      }
    }

    if (invoiceCompared === 0) {
      skippedWithoutComparableFields += 1;
      continue;
    }

    invoices.push({
      id: row.id,
      invoiceNumber:
        readComparableValue(reviewed.invoiceNumber) ??
        readComparableValue(extracted?.invoiceNumber),
      supplierName:
        readComparableValue(reviewed.supplierName) ??
        readComparableValue(extracted?.supplierName),
      reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
      compared: invoiceCompared,
      matches: invoiceMatches,
      corrections: invoiceCompared - invoiceMatches,
      lineItemsStructureChanged: structureChanged,
    });
  }

  finalize(totals);
  finalize(header);
  finalize(lineItems);
  for (const field of fields) finalize(field);

  return {
    approvedInvoices: considered.length,
    evaluatedInvoices: invoices.length,
    skippedWithoutReviewed,
    skippedWithoutComparableFields,
    lineItemsStructureChanged,
    truncated: rows.length > limit,
    limit,
    header,
    lineItems,
    totals,
    fields,
    invoices,
  };
}
