import { describe, expect, it } from "vitest";
import { buildReviewFormData } from "@/lib/review/form-fields";
import { parseReviewForm } from "@/lib/review/parse";

describe("review form serialization", () => {
  it("round-trips every editable top-level field", () => {
    const fd = buildReviewFormData({
      supplierName: "Acme",
      supplierTaxId: "SUP-1",
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-15",
      dueDate: "2026-02-15",
      currencyCode: "USD",
      subtotal: "10.00",
      taxTotal: "1.00",
      total: "11.00",
      paymentTerms: "Net 30",
      documentType: "invoice",
      orderNumber: "PO-9",
      buyerName: "Beta Corp",
      buyerTaxId: "BUY-1",
      shippingCost: "2.00",
      amountPaid: "5.00",
      balanceDue: "6.00",
      amountDiscounted: "1.00",
    });

    const parsed = parseReviewForm(fd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      supplierName: "Acme",
      supplierTaxId: "SUP-1",
      invoiceNumber: "INV-1",
      invoiceDate: "2026-01-15",
      dueDate: "2026-02-15",
      currencyCode: "USD",
      subtotal: "10.00",
      taxTotal: "1.00",
      total: "11.00",
      paymentTerms: "Net 30",
      documentType: "invoice",
      orderNumber: "PO-9",
      buyerName: "Beta Corp",
      buyerTaxId: "BUY-1",
      shippingCost: "2.00",
      amountPaid: "5.00",
      balanceDue: "6.00",
      amountDiscounted: "1.00",
    });
  });

  it("round-trips every editable line-item field in order", () => {
    const fd = buildReviewFormData({
      lineItems: [
        {
          description: "Widget",
          productCode: "SKU-1",
          quantity: "2",
          unit: "box",
          unitPrice: "5.00",
          discountRate: "10",
          discountAmount: "1.00",
          taxRate: "8",
          taxAmount: "0.80",
          lineTotal: "10.00",
        },
        { description: "Gadget", quantity: "1", unitPrice: "1.00", lineTotal: "1.00" },
      ],
    });

    const parsed = parseReviewForm(fd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lineItems).toHaveLength(2);
    expect(parsed.value.lineItems?.[0]).toMatchObject({
      description: "Widget",
      productCode: "SKU-1",
      quantity: "2",
      unit: "box",
      unitPrice: "5.00",
      discountRate: "10",
      discountAmount: "1.00",
      taxRate: "8",
      taxAmount: "0.80",
      lineTotal: "10.00",
    });
    expect(parsed.value.lineItems?.[1]?.description).toBe("Gadget");
  });
});
