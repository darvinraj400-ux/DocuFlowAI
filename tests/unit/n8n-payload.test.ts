import { describe, expect, it } from "vitest";
import {
  APPROVED_INVOICE_WEBHOOK_EVENT,
  buildApprovedInvoicePayload,
  type ApprovedInvoiceSource,
} from "@/lib/n8n/payload";

function source(overrides: Partial<ApprovedInvoiceSource> = {}): ApprovedInvoiceSource {
  return {
    id: "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f",
    extracted_data: {
      supplierName: "Extracted Supplier",
      invoiceNumber: "INV-77",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      currencyCode: "USD",
      subtotal: "100.00",
      taxTotal: "8.00",
      shippingCost: "2.00",
      total: "110.00",
      paymentTerms: "Net 30",
      lineItems: [
        {
          description: "Widget",
          productCode: "SKU-1",
          quantity: "2",
          unitPrice: "50.00",
          lineTotal: "100.00",
          vendorSku: "DO-NOT-SEND",
        },
      ],
      buyer: { email: "buyer@example.com" },
      paymentDetails: { iban: "DE89370400440532013000" },
      capture: { fullText: "document text that must not be sent" },
      additional_fields: { raw_input: { private: true } },
    },
    reviewed_data: { supplierName: "Reviewed Supplier" },
    reviewed_at: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("approved invoice webhook payload", () => {
  it("uses a stable event name", () => {
    expect(APPROVED_INVOICE_WEBHOOK_EVENT).toBe("invoice.approved");
  });

  it("sends only the allowlisted fields, merged from reviewed data", () => {
    const payload = buildApprovedInvoicePayload(source(), "2026-01-03T00:00:00.000Z");

    expect(payload).toEqual({
      event: "invoice.approved",
      invoice: {
        id: "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f",
        invoiceNumber: "INV-77",
        supplierName: "Reviewed Supplier",
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        currencyCode: "USD",
        subtotal: "100.00",
        taxTotal: "8.00",
        shippingCost: "2.00",
        total: "110.00",
        paymentTerms: "Net 30",
        approvedAt: "2026-01-02T03:04:05.000Z",
        lineItems: [
          {
            description: "Widget",
            productCode: "SKU-1",
            quantity: "2",
            unitPrice: "50.00",
            lineTotal: "100.00",
          },
        ],
      },
    });

    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "DO-NOT-SEND",
      "buyer@example.com",
      "DE89370400440532013000",
      "document text that must not be sent",
      "raw_input",
      "private",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("falls back to the approval timestamp when reviewed_at is missing or invalid", () => {
    expect(
      buildApprovedInvoicePayload(source({ reviewed_at: null }), "2026-02-02T00:00:00.000Z")
        .invoice.approvedAt,
    ).toBe("2026-02-02T00:00:00.000Z");

    expect(
      buildApprovedInvoicePayload(source({ reviewed_at: "not-a-date" }), "2026-02-03T00:00:00.000Z")
        .invoice.approvedAt,
    ).toBe("2026-02-03T00:00:00.000Z");
  });

  it("normalizes malformed line items and numeric money without inventing fields", () => {
    const payload = buildApprovedInvoicePayload(
      source({
        extracted_data: {
          lineItems: [
            { description: "Numeric", quantity: 2, unitPrice: 12.5, lineTotal: 25 },
            "not-an-object",
            { description: "  ", productCode: null },
          ],
        },
        reviewed_data: null,
      }),
      "2026-01-01T00:00:00.000Z",
    );

    expect(payload.invoice.lineItems).toEqual([
      {
        description: "Numeric",
        productCode: null,
        quantity: "2",
        unitPrice: "12.5",
        lineTotal: "25",
      },
      {
        description: null,
        productCode: null,
        quantity: null,
        unitPrice: null,
        lineTotal: null,
      },
    ]);
    expect(payload.invoice.supplierName).toBeNull();
    expect(payload.invoice.total).toBeNull();
  });

  it("handles missing extraction and review data", () => {
    const payload = buildApprovedInvoicePayload(
      source({ extracted_data: null, reviewed_data: null }),
      "2026-01-01T00:00:00.000Z",
    );

    expect(payload.invoice).toMatchObject({
      id: "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f",
      supplierName: null,
      invoiceNumber: null,
      total: null,
      lineItems: [],
    });
  });
});
