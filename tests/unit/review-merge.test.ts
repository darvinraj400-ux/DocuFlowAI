import { describe, expect, it } from "vitest";
import { mergeExtractionForReview } from "@/lib/review/merge";
import { parseReviewForm } from "@/lib/review/parse";
import { validateExtraction } from "@/lib/pipeline/validate";
import type { ExtractionResult } from "@/lib/pipeline/schema";

function richExtracted(): Partial<ExtractionResult> {
  return {
    supplierName: "ARGENTO NEUE",
    invoiceNumber: "#0000000001",
    invoiceDate: "2024-12-14",
    currencyCode: "USD",
    subtotal: "93.80",
    taxTotal: "6.07",
    total: "110.67",
    shippingCost: "10.80",
    balanceDue: "110.67",
    paymentDetails: { method: "Check / Money order" },
    seller: { name: "LuxuryStore", email: "support@luxurystore.example" },
    taxes: [{ name: "VAT", amount: "6.07" }],
    capture: { coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true } },
    additional_fields: { supplier_ambiguous: true, raw_input: { vendor: "ARGENTO NEUE" } },
  };
}

function legacyReviewed(): Partial<ExtractionResult> {
  return {
    supplierName: "Edited Supplier",
    invoiceNumber: "#0000000001",
    invoiceDate: "2024-12-14",
    currencyCode: "USD",
    subtotal: "93.80",
    taxTotal: "6.07",
    total: "110.67",
    paymentTerms: "Net 30",
    lineItems: [{ description: "Luma Analog Watch", quantity: "1", unitPrice: "43.8", taxAmount: null, lineTotal: "43.8" }],
  };
}

describe("review merge", () => {
  it("preserves universal fields when legacy reviewed data merges over richer extraction", () => {
    const merged = mergeExtractionForReview(richExtracted(), legacyReviewed());
    expect(merged.supplierName).toBe("Edited Supplier");
    expect(merged.shippingCost).toBe("10.80");
    expect(merged.balanceDue).toBe("110.67");
    expect(merged.paymentDetails).toMatchObject({ method: "Check / Money order" });
    expect(merged.seller).toMatchObject({ name: "LuxuryStore" });
    expect(merged.taxes).toHaveLength(1);
    expect(merged.capture?.coverage?.complete).toBe(true);
    expect(merged.additional_fields?.supplier_ambiguous).toBe(true);
  });

  it("explicit user corrections override extracted values", () => {
    const merged = mergeExtractionForReview(richExtracted(), { ...legacyReviewed(), total: "120.00" });
    expect(merged.total).toBe("120.00");
  });

  it("intentional blank legacy fields clear values", () => {
    const merged = mergeExtractionForReview(richExtracted(), { ...legacyReviewed(), paymentTerms: null });
    expect(merged.paymentTerms).toBeNull();
  });

  it("does not erase extracted additional fields with an empty placeholder", () => {
    const merged = mergeExtractionForReview(richExtracted(), { additional_fields: {} } as Partial<ExtractionResult>);
    expect(merged.additional_fields?.supplier_ambiguous).toBe(true);
  });

  it("empty extracted yields a reviewed-only payload", () => {
    const merged = mergeExtractionForReview(null, legacyReviewed());
    expect(merged.supplierName).toBe("Edited Supplier");
    expect(merged.shippingCost).toBeUndefined();
  });
});

describe("parseReviewForm keeps form-only edits", () => {
  function makeForm(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const entries: Record<string, string> = {
      supplierName: "ARGENTO NEUE",
      invoiceNumber: "#0000000001",
      invoiceDate: "2024-12-14",
      currencyCode: "USD",
      subtotal: "93.80",
      taxTotal: "6.07",
      total: "110.67",
      paymentTerms: "Net 30",
      shippingCost: "10.80",
      balanceDue: "110.67",
      li_0_description: "Luma Analog Watch",
      li_0_quantity: "1",
      li_0_unitPrice: "43.8",
      li_0_taxAmount: "",
      li_0_lineTotal: "43.8",
      ...overrides,
    };
    for (const [key, value] of Object.entries(entries)) {
      fd.set(key, value);
    }
    return fd;
  }

  it("returns canonical fields including universal review inputs", () => {
    const parsed = parseReviewForm(makeForm());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.supplierName).toBe("ARGENTO NEUE");
    expect(parsed.value.shippingCost).toBe("10.80");
    expect(parsed.value.balanceDue).toBe("110.67");
    expect(parsed.value.lineItems).toHaveLength(1);
  });

  it("treats blank editable fields as intentional nulls", () => {
    const parsed = parseReviewForm(makeForm({ shippingCost: "", paymentTerms: "" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.shippingCost).toBeNull();
    expect(parsed.value.paymentTerms).toBeNull();
  });
});

describe("effective merged data validates for approval", () => {
  it("does not raise MISSING_TOTAL when extraction supplies the total", () => {
    const merged = mergeExtractionForReview(richExtracted(), legacyReviewed());
    const findings = validateExtraction(merged as ExtractionResult);
    expect(findings.map((f) => f.code)).not.toContain("MISSING_TOTAL");
    expect(findings.map((f) => f.code)).not.toContain("MISSING_SUPPLIER");
  });
});
