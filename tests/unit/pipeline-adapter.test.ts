import { describe, expect, it } from "vitest";
import { parseExtraction } from "@/lib/pipeline/schema";
import { groundCaptureCoverage } from "@/lib/pipeline/capture";
import { materialConflictFindings, validateExtraction, captureCoverageFindings } from "@/lib/pipeline/validate";
import type { ExtractionResult } from "@/lib/pipeline/schema";

const CAPTURE_ONE_PAGE = {
  pages: [{ page: 1, text: "sample", extracted: true }],
  fullText: "sample",
  coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
};

function hvacClassification() {
  return {
    vendor: {
      name: "Your HVAC Co.",
      tax_id: "TX-48201",
      address: { street: "12 Cool Ave", city: "Austin", state: "TX", zip: "78701" },
      phone: "(512) 555-0100",
      email: "billing@yourhvac.example",
    },
    customer: {
      name: "Dwell Homes LLC",
      address: { street: "8 Oak Rd", city: "Round Rock", state: "TX", zip: "78664" },
    },
    invoice_number: "INV-10012",
    subtotal: "620.00",
    tax: "49.60",
    total: "669.60",
    service_date: "2024-07-15",
    job_number: "JOB-2049",
    payment_terms: "Net 30",
    warranty: "1-year parts & labor",
    work_performed: "HVAC installation",
    license: "TX HVAC-1234",
    epa_cert: "EPA-0001",
    notes: "Total due $669.60 in United States dollars",
    country: "United States",
    line_items: [
      { description: "Furnace", qty: 1, rate: 420.0, amount: 420.0 },
      { description: "Thermostat", qty: 1, rate: 140.0, amount: 140.0 },
      { description: "Duct sealant", qty: 2, rate: 15.0, amount: 30.0 },
      { description: "Permit", qty: 1, rate: 30.0, amount: 30.0 },
    ],
  };
}

describe("canonical ingestion adapter", () => {
  it("wrapped {capture, classification} HVAC invoice normalizes fully", () => {
    const raw = { capture: CAPTURE_ONE_PAGE, classification: hvacClassification() };
    const r = parseExtraction(raw);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    const v = r.value;
    expect(v.supplierName).toBe("Your HVAC Co.");
    expect(v.supplierTaxId).toBe("TX-48201");
    expect(v.seller).toMatchObject({
      name: "Your HVAC Co.",
      taxId: "TX-48201",
      phone: "(512) 555-0100",
      email: "billing@yourhvac.example",
    });
    expect(v.buyer).toMatchObject({ name: "Dwell Homes LLC" });
    expect(v.invoiceNumber).toBe("INV-10012");
    expect(v.subtotal).toBe("620.00");
    expect(v.taxTotal).toBe("49.60");
    expect(v.total).toBe("669.60");
    expect(v.paymentTerms).toBe("Net 30");
    expect(v.invoiceDate).toBeNull();
    expect(v.otherDates).toContain("2024-07-15");
    expect(v.lineItems).toHaveLength(4);
    expect(v.lineItems?.[0]).toMatchObject({ description: "Furnace", quantity: "1", unitPrice: "420", lineTotal: "420" });
    expect(v.lineItems?.[1]).toMatchObject({ description: "Thermostat", quantity: "1", unitPrice: "140", lineTotal: "140" });
    expect(v.lineItems?.[2]).toMatchObject({ description: "Duct sealant", quantity: "2", unitPrice: "15", lineTotal: "30" });
    expect(v.lineItems?.[3]).toMatchObject({ description: "Permit", quantity: "1", unitPrice: "30", lineTotal: "30" });
    expect(v.additional_fields).toMatchObject({
      job_number: "JOB-2049",
      warranty: "1-year parts & labor",
      work_performed: "HVAC installation",
      license: "TX HVAC-1234",
      epa_cert: "EPA-0001",
    });
    expect(v.additional_fields).not.toHaveProperty("classification");
    expect(v.capture?.coverage?.complete).toBe(true);
    expect(v.capture?.pages).toEqual(CAPTURE_ONE_PAGE.pages);
  });

  it("flat response normalizes equivalently to the wrapped classification", () => {
    const flat = parseExtraction(hvacClassification());
    const wrapped = parseExtraction({ capture: CAPTURE_ONE_PAGE, classification: hvacClassification() });
    expect(flat.ok).toBe(true);
    expect(wrapped.ok).toBe(true);
    if (!flat.ok || !wrapped.ok) return;
    const fields = (v: ExtractionResult) => ({
      supplierName: v.supplierName,
      invoiceNumber: v.invoiceNumber,
      subtotal: v.subtotal,
      taxTotal: v.taxTotal,
      total: v.total,
      lineItems: v.lineItems,
      otherDates: v.otherDates,
      seller: v.seller,
      buyer: v.buyer,
    });
    expect(fields(wrapped.value)).toEqual(fields(flat.value));
  });

  it("root-level fields win over classification with conflicts preserved and flagged", () => {
    const raw = {
      supplierName: "Root Vendor",
      classification: {
        vendor: { name: "Envelope Vendor" },
        invoice_number: "INV-1",
        total: "10.00",
      },
    };
    const r = parseExtraction(raw);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value.supplierName).toBe("Root Vendor");
    const conflicts = r.value.additional_fields?.conflicts as Array<Record<string, unknown>> | undefined;
    expect(conflicts).toBeDefined();
    expect(conflicts!.some((c) => c.field === "supplierName")).toBe(true);
    expect(conflicts!.some((c) => c.field === "supplierName" && JSON.stringify(c.values) === JSON.stringify(["Root Vendor", "Envelope Vendor"]))).toBe(true);

    const findings = materialConflictFindings(r.value);
    expect(findings.map((f) => f.code)).toContain("FIELD_CONFLICT");
  });

  it("service date does not become the invoice date; invoice date stays missing for review", () => {
    const r = parseExtraction({ classification: hvacClassification() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.invoiceDate).toBeNull();
    expect(r.value.otherDates).toContain("2024-07-15");
    const findings = validateExtraction(r.value);
    expect(findings.map((f) => f.code)).toContain("MISSING_INVOICE_DATE");
  });

  it("currency is inferred only under documented evidence with provenance", () => {
    const withUsContext = parseExtraction({
      vendor: "A",
      total: "669.60",
      country: "United States",
      address: "Austin, TX",
      notes: "Total due $669.60 dollars",
    });
    expect(withUsContext.ok).toBe(true);
    if (withUsContext.ok) {
      expect(withUsContext.value.currencyCode).toBe("USD");
      expect(withUsContext.value.additional_fields?._inferred_currency).toMatchObject({ field: "currencyCode", value: "USD", confidence: "medium" });
      expect((withUsContext.value.capture?.inferences as Array<Record<string, unknown>> | undefined)?.[0]?.field).toBe("currencyCode");
    }

    const noUsContext = parseExtraction({ vendor: "A", total: "669.60", address: "Vienna" });
    expect(noUsContext.ok).toBe(true);
    if (noUsContext.ok) {
      expect(noUsContext.value.currencyCode).toBeNull();
      expect(noUsContext.value.additional_fields?._inferred_currency).toBeUndefined();
    }
  });

  it("Argento invoice still normalizes with ambiguity, totals, and line items", () => {
    const raw = {
      vendor: "ARGENTO NEUE",
      currency: "USD",
      subtotal: "93.80",
      tax: "6.07",
      shipping: "10.80",
      amount_due: "110.67",
      invoice_number: "#0000000001",
      invoice_date: "2024-12-14",
      line_items: [
        { description: "Luma Analog Watch", quantity: 1, unit_price: 43.8, line_total: 43.8 },
        { description: "Fusion Backpack", quantity: 1, unit_price: 50.0, line_total: 50.0 },
      ],
      payment_method: "Check / Money order",
      seller: { name: "LuxuryStore" },
    };
    const r = parseExtraction(raw);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value.supplierName).toBe("ARGENTO NEUE");
    expect(r.value.total).toBe("110.67");
    expect(r.value.taxTotal).toBe("6.07");
    expect(r.value.shippingCost).toBe("10.80");
    expect(r.value.currencyCode).toBe("USD");
    expect(r.value.invoiceNumber).toBe("#0000000001");
    expect(r.value.paymentDetails).toMatchObject({ method: "Check / Money order" });
    expect(r.value.lineItems).toHaveLength(2);
    expect(r.value.additional_fields?.supplier_alternatives).toEqual(["ARGENTO NEUE", "LuxuryStore"]);
    expect(r.value.additional_fields?.supplier_ambiguous).toBe(true);
  });

  it("normalization is idempotent on the canonical core", () => {
    const hvac = { classification: hvacClassification(), capture: CAPTURE_ONE_PAGE };
    const first = parseExtraction(hvac);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parseExtraction(first.value);
    expect(second.ok, second.ok ? "" : second.error).toBe(true);
    if (!second.ok) return;
    const core = (v: ExtractionResult) => ({
      supplierName: v.supplierName,
      invoiceNumber: v.invoiceNumber,
      subtotal: v.subtotal,
      taxTotal: v.taxTotal,
      total: v.total,
      lineItems: v.lineItems,
      otherDates: v.otherDates,
      seller: v.seller,
      buyer: v.buyer,
      currencyCode: v.currencyCode,
    });
    expect(core(second.value)).toEqual(core(first.value));
  });

  it("genuine missing required fields still produce validation errors", () => {
    const r = parseExtraction({ classification: { vendor: { name: "Only Vendor" } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codes = validateExtraction(r.value).map((f) => f.code);
    expect(codes).toContain("MISSING_INVOICE_NUMBER");
    expect(codes).toContain("MISSING_INVOICE_DATE");
    expect(codes).toContain("MISSING_TOTAL");
  });

  it("partial coverage and forged completion remain handled", () => {
    const grounded = groundCaptureCoverage(
      { pages: [], fullText: null, coverage: { pagesTotal: 10, pagesProcessed: 10, pagesFailed: 0, complete: true } },
      { pageCount: 10, pagesProcessed: 3 },
    );
    expect(grounded.coverage?.complete).toBe(false);
    expect(String(grounded.coverage?.note)).toContain("Model reported complete");
    const partial = groundCaptureCoverage(CAPTURE_ONE_PAGE, { pageCount: 2, pagesProcessed: 1 });
    expect(partial.coverage?.complete).toBe(false);
    const parsed = parseExtraction({ supplierName: "a", total: "1" });
    if (!parsed.ok) throw new Error("fixture should parse");
    expect(captureCoverageFindings({ ...parsed.value, capture: partial } as ExtractionResult).map((f) => f.code)).toContain("PARTIAL_EXTRACTION");
  });
});
