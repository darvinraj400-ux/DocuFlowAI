import type { ExtractionInput, ExtractionOutcome, ExtractionProvider } from "@/lib/providers/types";

/**
 * Deterministic mock extraction provider for tests and local development.
 * Returns a fixed, valid sample invoice and is always labelled `demo: true`.
 * It never requires an API key or network access.
 */
const SAMPLE: ExtractionOutcome = {
  ok: true,
  data: {
    supplierName: "Acme Supplies Ltd",
    supplierTaxId: "GB123456789",
    invoiceNumber: "INV-2026-0001",
    invoiceDate: "2026-05-14",
    issueDate: "2026-05-14",
    dueDate: "2026-06-13",
    currencyCode: "GBP",
    subtotal: "1000.00",
    taxTotal: "200.00",
    total: "1200.00",
    paymentTerms: "Net 30",
    documentType: "invoice",
    orderNumber: "PO-2026-091",
    seller: { name: "Acme Supplies Ltd", taxId: "GB123456789", address: "1 Factory Road, London" },
    buyer: { name: "Northwind GmbH", taxId: "DE123456789" },
    buyerName: "Northwind GmbH",
    amountPaid: "0.00",
    balanceDue: "1200.00",
    taxes: [{ name: "VAT", rate: "20.00", amount: "200.00", base: "1000.00" }],
    paymentDetails: { method: "Bank transfer", iban: "GB29NWBK60161331926819" },
    lineItems: [
      {
        description: "Widget assembly service",
        quantity: "10",
        unit: "unit",
        unitPrice: "100.00",
        taxAmount: null,
        lineTotal: "1000.00",
      },
    ],
    additional_fields: { internal_ref: "ACME-2026-001" },
    capture: {
      pages: [
        {
          page: 1,
          text: "INVOICE INV-2026-0001 | Acme Supplies Ltd | PO-2026-091 | Net 30 | Total GBP 1200.00",
          images: 0,
          truncated: false,
          extracted: true,
        },
      ],
      fullText: "INVOICE INV-2026-0001 | Acme Supplies Ltd | PO-2026-091 | Net 30 | Total GBP 1200.00",
      coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
      evidence: { invoiceNumber: { page: 1 }, total: { page: 1 } },
    },
  },
  meta: {
    provider: "mock",
    model: "mock-deterministic",
    demo: true,
    durationMs: 0,
  },
};

export class MockProvider implements ExtractionProvider {
  readonly id = "mock";
  readonly demo = true;

  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    void input;
    return SAMPLE;
  }
}
