import { describe, expect, it } from "vitest";
import { captureCoverageFindings, hasErrorFindings, validateExtraction } from "@/lib/pipeline/validate";
import type { ExtractionResult } from "@/lib/pipeline/schema";

function base(): ExtractionResult {
  return {
    supplierName: "Acme",
    supplierTaxId: null,
    invoiceNumber: "INV-1",
    invoiceDate: "2026-05-14",
    dueDate: null,
    currencyCode: "USD",
    subtotal: "100.00",
    taxTotal: "10.00",
    total: "110.00",
    paymentTerms: null,
    lineItems: [{ description: "S", quantity: "1", unitPrice: "100.00", taxAmount: null, lineTotal: "100.00" }],
  };
}

describe("validation findings", () => {
  it("produces no errors for a valid extraction", () => {
    const findings = validateExtraction(base());
    expect(hasErrorFindings(findings)).toBe(false);
  });

  it("flags missing required fields", () => {
    const v = base();
    v.supplierName = null;
    v.invoiceNumber = null;
    v.invoiceDate = null;
    v.currencyCode = null;
    v.total = null;
    const findings = validateExtraction(v);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("MISSING_SUPPLIER");
    expect(codes).toContain("MISSING_INVOICE_NUMBER");
    expect(codes).toContain("MISSING_INVOICE_DATE");
    expect(codes).toContain("MISSING_CURRENCY");
    expect(codes).toContain("MISSING_TOTAL");
    expect(hasErrorFindings(findings)).toBe(true);
  });

  it("flags invalid dates", () => {
    const v = base();
    v.invoiceDate = "2026-02-31";
    const findings = validateExtraction(v);
    expect(findings.map((f) => f.code)).toContain("INVALID_DATE");
  });

  it("flags invalid and unsupported currencies", () => {
    const v = base();
    v.currencyCode = "US";
    expect(validateExtraction(v).map((f) => f.code)).toContain("INVALID_CURRENCY");
    v.currencyCode = "XYZ";
    expect(validateExtraction(v).map((f) => f.code)).toContain("UNSUPPORTED_CURRENCY");
  });

  it("flags inconsistent totals as a warning", () => {
    const v = base();
    v.total = "999.00";
    const findings = validateExtraction(v);
    expect(findings.map((f) => f.code)).toContain("INCONSISTENT_TOTALS");
    expect(hasErrorFindings(findings)).toBe(false);
  });

  it("flags negative amounts", () => {
    const v = base();
    v.total = "-10.00";
    expect(validateExtraction(v).map((f) => f.code)).toContain("NEGATIVE_AMOUNT");
  });

  it("flags line-item mismatches as warnings", () => {
    const v = base();
    v.lineItems![0].lineTotal = "500.00";
    const findings = validateExtraction(v);
    expect(findings.map((f) => f.code)).toContain("LINE_ITEM_TOTAL_MISMATCH");
  });

  it("flags partial extraction coverage as a warning", () => {
    const v = base();
    v.capture = {
      pages: [{ page: 1, text: "p1" }, { page: 2, text: null }],
      coverage: { pagesTotal: 2, pagesProcessed: 1, pagesFailed: 1, complete: false },
    };
    const findings = captureCoverageFindings(v);
    expect(findings.map((f) => f.code)).toContain("PARTIAL_EXTRACTION");
    expect(findings.some((f) => f.severity === "warning")).toBe(true);
    expect(findings[0]!.message).toContain("1 of 2");
  });

  it("reports a full coverage report as no warning", () => {
    const v = base();
    v.capture = { coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true } };
    expect(captureCoverageFindings(v)).toEqual([]);
  });
});
