import { describe, expect, it } from "vitest";
import { parseExtraction } from "@/lib/pipeline/schema";

describe("extraction schema", () => {
  const valid = {
    supplierName: "Acme",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-05-14",
    currencyCode: "USD",
    subtotal: "100.00",
    taxTotal: "10.00",
    total: "110.00",
    lineItems: [{ description: "Service", quantity: "1", unitPrice: "100.00", taxAmount: "10.00", lineTotal: "110.00" }],
  };

  it("accepts a valid extraction", () => {
    const result = parseExtraction(valid);
    expect(result.ok).toBe(true);
  });

  it("preserves unknown fields in additional_fields", () => {
    const r = parseExtraction({ ...valid, extra: "nope" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.additional_fields?.extra).toBe("nope");
    }
  });

  it("rejects non-decimal money", () => {
    const r = parseExtraction({ ...valid, total: "one hundred" });
    expect(r.ok).toBe(false);
  });

  it("normalizes missing/malformed into null", () => {
    const r = parseExtraction({ ...valid, supplierName: undefined, total: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.supplierName).toBeNull();
      expect(r.value.total).toBeNull();
      expect(r.value.lineItems).toHaveLength(1);
    }
  });

  it("rejects malformed JSON-ish input", () => {
    const r = parseExtraction("not-an-object");
    expect(r.ok).toBe(false);
  });
});
