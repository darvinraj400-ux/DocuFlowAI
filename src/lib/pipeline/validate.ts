import type { ValidationFinding } from "@/types/invoice";
import type { ExtractionResult } from "@/lib/pipeline/schema";
import { lineTotalIsConsistent, isNonNegative, totalsAreConsistent } from "@/lib/pipeline/money";
import { normalizeCurrency } from "@/lib/pipeline/normalize";

/** ISO 4217 currencies we model for the initial implementation. */
const SUPPORTED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "MYR", "SGD", "AUD", "CAD", "JPY", "CNY", "INR",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function validateExtraction(result: ExtractionResult): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  const requireField = (value: string | null | undefined, code: string, message: string, field: string) => {
    if (value == null || value.trim() === "") {
      findings.push({ code, severity: "error", message, field });
    }
  };

  requireField(result.supplierName, "MISSING_SUPPLIER", "Supplier name is required.", "supplierName");
  requireField(result.invoiceNumber, "MISSING_INVOICE_NUMBER", "Invoice number is required.", "invoiceNumber");
  requireField(result.invoiceDate, "MISSING_INVOICE_DATE", "Invoice date is required.", "invoiceDate");
  requireField(result.currencyCode, "MISSING_CURRENCY", "Currency is required.", "currencyCode");
  requireField(result.total, "MISSING_TOTAL", "Invoice total is required.", "total");

  if (result.invoiceDate != null && result.invoiceDate.trim() !== "") {
    if (!isValidDate(result.invoiceDate)) {
      findings.push({ code: "INVALID_DATE", severity: "error", message: "Invoice date is not a valid date.", field: "invoiceDate" });
    } else {
      const today = new Date().toISOString().slice(0, 10);
      if (result.invoiceDate > today) {
        findings.push({ code: "DATE_IN_FUTURE", severity: "warning", message: "Invoice date is in the future.", field: "invoiceDate" });
      }
    }
  }

  if (result.dueDate != null && result.dueDate.trim() !== "" && !isValidDate(result.dueDate)) {
    findings.push({ code: "INVALID_DUE_DATE", severity: "warning", message: "Due date is not a valid date.", field: "dueDate" });
  }

  if (result.currencyCode != null && result.currencyCode.trim() !== "") {
    const currency = normalizeCurrency(result.currencyCode);
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      findings.push({ code: "INVALID_CURRENCY", severity: "error", message: "Currency code must be a 3-letter ISO code.", field: "currencyCode" });
    } else if (!SUPPORTED_CURRENCIES.has(currency)) {
      findings.push({ code: "UNSUPPORTED_CURRENCY", severity: "warning", message: `Currency "${currency}" is valid but not in the supported list.`, field: "currencyCode" });
    }
  }

  for (const key of ["subtotal", "taxTotal", "total"] as const) {
    const value = result[key];
    if (value != null && !isNonNegative(value)) {
      findings.push({ code: "NEGATIVE_AMOUNT", severity: "error", message: `${key} must not be negative.`, field: key });
    }
  }

  const totalsOk = totalsAreConsistent(result.subtotal, result.taxTotal, result.total);
  if (totalsOk === false) {
    findings.push({
      code: "INCONSISTENT_TOTALS",
      severity: "warning",
      message: "Subtotal + tax does not match the invoice total.",
      field: "total",
    });
  } else if (totalsOk === null && result.total != null && result.subtotal == null) {
    findings.push({
      code: "MISSING_SUBTOTAL",
      severity: "info",
      message: "Subtotal missing; total could not be cross-checked.",
      field: "subtotal",
    });
  }

  (result.lineItems ?? []).forEach((line, index) => {
    const base = `lineItems[${index}]`;
    if (line.description == null || line.description.trim() === "") {
      findings.push({ code: "LINE_ITEM_MISSING_DESCRIPTION", severity: "warning", message: "Line item is missing a description.", field: `${base}.description` });
    }
    const consistent = lineTotalIsConsistent(line.quantity, line.unitPrice, line.lineTotal);
    if (consistent === false) {
      findings.push({ code: "LINE_ITEM_TOTAL_MISMATCH", severity: "warning", message: "Line item quantity × unit price does not match its total.", field: `${base}.lineTotal` });
    } else if (consistent === null && line.lineTotal != null && (line.quantity == null || line.unitPrice == null)) {
      findings.push({ code: "LINE_ITEM_INCOMPLETE", severity: "info", message: "Line item lacks quantity or unit price for a full check.", field: base });
    }
    for (const numField of ["quantity", "unitPrice", "taxAmount", "lineTotal"] as const) {
      const v = line[numField];
      if (v != null && !isNonNegative(v)) {
        findings.push({ code: "NEGATIVE_AMOUNT", severity: "error", message: "Line item value must not be negative.", field: `${base}.${numField}` });
      }
    }
  });

  return findings;
}

/**
 * Findings about extraction coverage: partial extraction (failed/unprocessed
 * pages) must never be silently treated as complete.
 */
export function captureCoverageFindings(result: ExtractionResult): ValidationFinding[] {
  const coverage = result.capture?.coverage;
  if (!coverage) return [];
  const findings: ValidationFinding[] = [];
  if (coverage.complete === false || (coverage.pagesFailed ?? 0) > 0) {
    findings.push({
      code: "PARTIAL_EXTRACTION",
      severity: "warning",
      message: `Extraction is incomplete: ${coverage.pagesProcessed ?? 0} of ${coverage.pagesTotal ?? "?"} pages processed, ${coverage.pagesFailed ?? 0} failed. Review missing content before approving.`,
      field: "capture.coverage",
    });
  } else if (coverage.pagesTotal != null && coverage.pagesProcessed != null && coverage.pagesProcessed < coverage.pagesTotal) {
    findings.push({
      code: "PARTIAL_EXTRACTION",
      severity: "info",
      message: `Extraction covered ${coverage.pagesProcessed} of ${coverage.pagesTotal} pages.`,
      field: "capture.coverage",
    });
  }
  return findings;
}

/**
 * Material conflicts between root-level and wrapped `classification` fields
 * are never silently discarded — they surface as warnings for review.
 */
export function materialConflictFindings(result: ExtractionResult): ValidationFinding[] {
  const conflicts = result.additional_fields?.conflicts;
  if (!Array.isArray(conflicts) || conflicts.length === 0) return [];
  return conflicts.map((conflict, i) => ({
    code: "FIELD_CONFLICT",
    severity: "warning",
    message: `Conflicting values for "${String(conflict.field)}": ${JSON.stringify(conflict.values)} (sources: ${JSON.stringify(conflict.sources)}). The first (root) value was kept; review before approving.`,
    field: `additional_fields.conflicts[${i}]`,
  }));
}

export function hasErrorFindings(findings: readonly ValidationFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
