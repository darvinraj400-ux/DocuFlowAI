import { describe, expect, it } from "vitest";
import { parseReviewForm } from "@/lib/review/parse";

function makeForm(lines: Array<Record<string, string>>, overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    supplierName: "Acme",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-15",
    currencyCode: "USD",
    subtotal: "10.00",
    taxTotal: "1.00",
    total: "11.00",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) fd.set(key, value);
  lines.forEach((line, index) => {
    for (const [key, value] of Object.entries(line)) {
      fd.set(`li_${index}_${key}`, value);
    }
    if (!("description" in line)) fd.set(`li_${index}_description`, "");
  });
  return fd;
}

describe("parseReviewForm line items", () => {
  it("parses added rows in order", () => {
    const parsed = parseReviewForm(
      makeForm([
        { description: "Widget", quantity: "2", unitPrice: "5.00", lineTotal: "10.00" },
        { description: "Gadget", quantity: "1", unitPrice: "1.00", lineTotal: "1.00" },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lineItems?.map((line) => line.description)).toEqual(["Widget", "Gadget"]);
  });

  it("preserves extraction-only line fields through an edit", () => {
    const parsed = parseReviewForm(
      makeForm([
        {
          description: "Widget",
          productCode: "SKU-1",
          unit: "box",
          quantity: "2",
          unitPrice: "5.00",
          discountRate: "10",
          discountAmount: "1.00",
          taxRate: "8",
          taxAmount: "0.80",
          lineTotal: "10.00",
        },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lineItems?.[0]).toMatchObject({
      productCode: "SKU-1",
      unit: "box",
      discountRate: "10",
      discountAmount: "1.00",
      taxRate: "8",
    });
  });

  it("drops fully blank scaffolding rows", () => {
    const parsed = parseReviewForm(
      makeForm([
        { description: "Widget", quantity: "2", unitPrice: "5.00", lineTotal: "10.00" },
        {},
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lineItems).toHaveLength(1);
  });

  it("supports removing every line item", () => {
    const parsed = parseReviewForm(makeForm([]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lineItems).toEqual([]);
  });

  it("rejects malformed decimal money with a field error", () => {
    const parsed = parseReviewForm(
      makeForm([{ description: "Widget", quantity: "1,5", unitPrice: "5.00", lineTotal: "7.50" }]),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.lineItems).toContain("decimal");
  });

  it("reports top-level money errors on their own field", () => {
    const parsed = parseReviewForm(makeForm([], { total: "$11.00" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.total).toContain("decimal");
  });

  it("leaves fields that were not submitted untouched", () => {
    const fd = new FormData();
    fd.set("supplierName", "Acme");
    const parsed = parseReviewForm(fd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("total" in parsed.value).toBe(false);
    expect("documentType" in parsed.value).toBe(false);
  });

  it("treats a submitted blank field as an intentional clear", () => {
    const parsed = parseReviewForm(makeForm([], { total: "" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.total).toBeNull();
  });

  it("keeps source indexes aligned with the rows that survive", () => {
    const parsed = parseReviewForm(
      makeForm([
        { description: "Widget", sourceIndex: "0" },
        { description: "", sourceIndex: "1" },
        { description: "Gadget", sourceIndex: "2" },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lineItems?.map((line) => line.description)).toEqual(["Widget", "Gadget"]);
    expect(parsed.lineSources).toEqual([0, 2]);
  });

  it("treats malformed source indexes as unassociated rows", () => {
    const parsed = parseReviewForm(
      makeForm([
        { description: "A", sourceIndex: "-1" },
        { description: "B", sourceIndex: "abc" },
        { description: "C", sourceIndex: "1.5" },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lineSources).toEqual([null, null, null]);
    expect(parsed.value.lineItems?.[0]).not.toHaveProperty("sourceIndex");
  });
});
