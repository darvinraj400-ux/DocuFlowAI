import { PDFDocument, StandardFonts } from "pdf-lib";
import type { SyntheticSample } from "@/lib/evaluation/types";

/**
 * Synthetic evaluation invoices with known ground truth.
 *
 * `acme` intentionally mirrors the MockProvider fixture so the offline suite
 * has a deterministic 100% baseline. The other samples exercise multi-line
 * invoices, sparse documents, fractional quantities, and alternate currencies;
 * they are evaluated only by the opt-in live suite because the mock provider
 * always returns the Acme fixture regardless of input.
 */

async function renderPdf(lines: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([520, 720]);
  lines.forEach((text, index) => {
    page.drawText(text, { x: 48, y: 680 - index * 24, size: 11, font });
  });
  return doc.save();
}

function pdfFactory(lines: readonly string[]): () => Promise<Uint8Array> {
  let cached: Promise<Uint8Array> | null = null;
  return () => {
    cached ??= renderPdf(lines);
    return cached;
  };
}

export const ACME_SAMPLE: SyntheticSample = {
  id: "acme-baseline",
  name: "Acme baseline",
  description: "Single-line GBP invoice that mirrors the deterministic mock fixture.",
  expected: {
    supplierName: "Acme Supplies Ltd",
    supplierTaxId: "GB123456789",
    invoiceNumber: "INV-2026-0001",
    invoiceDate: "2026-05-14",
    dueDate: "2026-06-13",
    currencyCode: "GBP",
    subtotal: "1000.00",
    taxTotal: "200.00",
    total: "1200.00",
    paymentTerms: "Net 30",
    documentType: "invoice",
    orderNumber: "PO-2026-091",
    buyerName: "Northwind GmbH",
    amountPaid: "0.00",
    balanceDue: "1200.00",
    lineItems: [
      {
        description: "Widget assembly service",
        quantity: "10",
        unit: "unit",
        unitPrice: "100.00",
        lineTotal: "1000.00",
      },
    ],
    taxes: [{ name: "VAT", rate: "20.00", amount: "200.00", base: "1000.00" }],
  },
  makeBytes: pdfFactory([
    "ACME SUPPLIES LTD",
    "INVOICE",
    "Invoice number: INV-2026-0001",
    "Invoice date: 2026-05-14",
    "Due date: 2026-06-13",
    "Order number: PO-2026-091",
    "Payment terms: Net 30",
    "Buyer: Northwind GmbH",
    "Currency: GBP",
    "Widget assembly service",
    "Qty 10 x 100.00 = 1000.00",
    "Subtotal: 1000.00",
    "VAT 20%: 200.00",
    "Total: 1200.00",
  ]),
};

export const GLOBEX_SAMPLE: SyntheticSample = {
  id: "globex-multiline-eur",
  name: "Globex multi-line EUR",
  description: "Two line items in EUR with a 19% VAT component.",
  expected: {
    supplierName: "Globex S.A.",
    invoiceNumber: "GX-2026-0042",
    invoiceDate: "2026-04-02",
    dueDate: "2026-05-02",
    currencyCode: "EUR",
    documentType: "invoice",
    orderNumber: "PO-77",
    buyerName: "Contoso Ltd",
    paymentTerms: "Net 15",
    subtotal: "380.00",
    taxTotal: "72.20",
    total: "452.20",
    lineItems: [
      {
        description: "Design retainer",
        quantity: "2",
        unitPrice: "90.50",
        lineTotal: "181.00",
      },
      {
        description: "Onsite workshop",
        quantity: "1",
        unitPrice: "199.00",
        lineTotal: "199.00",
      },
    ],
    taxes: [{ name: "VAT", rate: "19.00", amount: "72.20", base: "380.00" }],
  },
  makeBytes: pdfFactory([
    "GLOBEX S.A.",
    "INVOICE",
    "Invoice number: GX-2026-0042",
    "Invoice date: 2026-04-02",
    "Due date: 2026-05-02",
    "Order number: PO-77",
    "Payment terms: Net 15",
    "Buyer: Contoso Ltd",
    "Currency: EUR",
    "Design retainer",
    "Qty 2 x 90.50 = 181.00",
    "Onsite workshop",
    "Qty 1 x 199.00 = 199.00",
    "Subtotal: 380.00",
    "VAT 19%: 72.20",
    "Total: 452.20",
  ]),
};

export const INITECH_SAMPLE: SyntheticSample = {
  id: "initech-sparse",
  name: "Initech sparse",
  description: "Minimal USD invoice with no tax, due date, or line items.",
  expected: {
    supplierName: "Initech LLC",
    invoiceNumber: "IN-2026-301",
    invoiceDate: "2026-03-18",
    currencyCode: "USD",
    total: "250.00",
  },
  makeBytes: pdfFactory([
    "INITECH LLC",
    "INVOICE",
    "Invoice number: IN-2026-301",
    "Invoice date: 2026-03-18",
    "Currency: USD",
    "Total: 250.00",
  ]),
};

export const UMBRELLA_SAMPLE: SyntheticSample = {
  id: "umbrella-fractional",
  name: "Umbrella fractional",
  description: "USD invoice with fractional quantities and a discount total.",
  expected: {
    supplierName: "Umbrella Corp",
    invoiceNumber: "UM-2026-771",
    invoiceDate: "2026-06-08",
    dueDate: "2026-07-08",
    currencyCode: "USD",
    subtotal: "55.00",
    taxTotal: "4.40",
    total: "59.40",
    amountDiscounted: "5.00",
    lineItems: [
      {
        description: "Support hours",
        quantity: "1.5",
        unit: "hour",
        unitPrice: "20.00",
        lineTotal: "30.00",
      },
      {
        description: "License fee",
        quantity: "2",
        unitPrice: "12.50",
        lineTotal: "25.00",
      },
    ],
    taxes: [{ name: "Sales tax", rate: "8.00", amount: "4.40", base: "55.00" }],
  },
  makeBytes: pdfFactory([
    "UMBRELLA CORP",
    "INVOICE",
    "Invoice number: UM-2026-771",
    "Invoice date: 2026-06-08",
    "Due date: 2026-07-08",
    "Currency: USD",
    "Support hours",
    "Qty 1.5 x 20.00 = 30.00",
    "License fee",
    "Qty 2 x 12.50 = 25.00",
    "Subtotal: 55.00",
    "Sales tax 8%: 4.40",
    "Total: 59.40",
    "Discount applied: 5.00",
  ]),
};

export const SYNTHETIC_SAMPLES: readonly SyntheticSample[] = [
  ACME_SAMPLE,
  GLOBEX_SAMPLE,
  INITECH_SAMPLE,
  UMBRELLA_SAMPLE,
];
