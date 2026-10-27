import { describe, expect, it } from "vitest";
import {
  buildExtractionAccuracyReport,
  type AccuracyFieldStats,
  type AccuracyInvoiceRow,
} from "@/lib/reports/extraction-accuracy";

function row(
  id: string,
  extracted: unknown,
  reviewed: unknown,
  reviewedAt: string | null = null,
): AccuracyInvoiceRow {
  return { id, extracted_data: extracted, reviewed_data: reviewed, reviewed_at: reviewedAt };
}

function headerField(report: ReturnType<typeof buildExtractionAccuracyReport>, key: string): AccuracyFieldStats {
  const field = report.fields.find((candidate) => candidate.group === "header" && candidate.key === key);
  if (!field) throw new Error(`Missing header field ${key}`);
  return field;
}

describe("extraction accuracy report", () => {
  it("distinguishes matches, corrections, missed values, and cleared values", () => {
    const report = buildExtractionAccuracyReport([
      row(
        "inv-1",
        {
          supplierName: "Acme Ltd",
          invoiceNumber: "INV-1",
          total: "100.00",
          paymentTerms: "Net 30",
        },
        {
          supplierName: "acme ltd",
          invoiceNumber: "INV-1-REV",
          total: null,
          buyerName: "Contoso",
        },
      ),
    ]);

    expect(report.approvedInvoices).toBe(1);
    expect(report.evaluatedInvoices).toBe(1);
    expect(report.header).toMatchObject({
      compared: 4,
      matches: 1,
      corrected: 1,
      missed: 1,
      cleared: 1,
    });
    expect(report.header.accuracy).toBeCloseTo(0.25);
    expect(report.totals).toMatchObject(report.header);
    expect(report.lineItems.compared).toBe(0);
    expect(report.lineItems.accuracy).toBeNull();

    expect(headerField(report, "supplierName")).toMatchObject({ compared: 1, matches: 1 });
    expect(headerField(report, "invoiceNumber")).toMatchObject({ compared: 1, corrected: 1 });
    expect(headerField(report, "total")).toMatchObject({ compared: 1, cleared: 1 });
    expect(headerField(report, "buyerName")).toMatchObject({ compared: 1, missed: 1 });
    // paymentTerms exists on the extraction but is absent from the reviewed
    // snapshot, so it must not be scored.
    expect(headerField(report, "paymentTerms")).toMatchObject({ compared: 0, accuracy: null });

    expect(report.invoices).toEqual([
      {
        id: "inv-1",
        invoiceNumber: "INV-1-REV",
        supplierName: "acme ltd",
        reviewedAt: null,
        compared: 4,
        matches: 1,
        corrections: 3,
        lineItemsStructureChanged: false,
      },
    ]);
  });

  it("skips rows without a reviewed snapshot or without comparable fields", () => {
    const report = buildExtractionAccuracyReport([
      row("missing", { invoiceNumber: "INV-1" }, null),
      row("not-an-object", { invoiceNumber: "INV-2" }, "reviewed"),
      row("empty", { invoiceNumber: "INV-3" }, {}),
      row("unrelated", { invoiceNumber: "INV-4" }, { notes: "Reviewed elsewhere" }),
    ]);

    expect(report.approvedInvoices).toBe(4);
    expect(report.evaluatedInvoices).toBe(0);
    expect(report.skippedWithoutReviewed).toBe(2);
    expect(report.skippedWithoutComparableFields).toBe(2);
    expect(report.invoices).toEqual([]);
    expect(report.totals).toMatchObject({ compared: 0, matches: 0, accuracy: null });
  });

  it("compares line items positionally and excludes structural edits", () => {
    const report = buildExtractionAccuracyReport([
      row(
        "same-shape",
        {
          invoiceNumber: "INV-1",
          lineItems: [
            { description: "Widget", quantity: "1.0" },
            { description: "Bolt", quantity: "2" },
          ],
        },
        {
          invoiceNumber: "INV-1",
          lineItems: [
            { description: "Widget", quantity: "1.00" },
            { description: "Bolt (updated)", quantity: "2" },
          ],
        },
      ),
      row(
        "structure-changed",
        {
          invoiceNumber: "INV-2",
          lineItems: [{ description: "One", quantity: "1" }],
        },
        {
          invoiceNumber: "INV-2",
          lineItems: [
            { description: "One", quantity: "1" },
            { description: "Two", quantity: "1" },
          ],
        },
      ),
    ]);

    expect(report.header).toMatchObject({ compared: 2, matches: 2 });
    expect(report.lineItems).toMatchObject({
      compared: 4,
      matches: 3,
      corrected: 1,
      accuracy: 0.75,
    });
    expect(report.totals).toMatchObject({ compared: 6, matches: 5, corrected: 1 });
    expect(report.lineItemsStructureChanged).toBe(1);

    const changed = report.invoices.find((invoice) => invoice.id === "structure-changed");
    expect(changed?.lineItemsStructureChanged).toBe(true);
    expect(changed?.compared).toBe(1);
    expect(report.invoices.find((invoice) => invoice.id === "same-shape")?.lineItemsStructureChanged).toBe(false);
  });

  it("bounds the report and flags truncation", () => {
    const rows = [
      row("1", { invoiceNumber: "INV-1" }, { invoiceNumber: "INV-1" }),
      row("2", { invoiceNumber: "INV-2" }, { invoiceNumber: "INV-2" }),
      row("3", { invoiceNumber: "INV-3" }, { invoiceNumber: "INV-3" }),
    ];

    const limited = buildExtractionAccuracyReport(rows, { limit: 2 });
    expect(limited.limit).toBe(2);
    expect(limited.truncated).toBe(true);
    expect(limited.approvedInvoices).toBe(2);
    expect(limited.evaluatedInvoices).toBe(2);
    expect(limited.header.compared).toBe(2);
    expect(limited.invoices.map((invoice) => invoice.id)).toEqual(["1", "2"]);

    const complete = buildExtractionAccuracyReport(rows, { limit: 10 });
    expect(complete.truncated).toBe(false);
    expect(complete.approvedInvoices).toBe(3);
  });

  it("uses reviewed display values, falls back to extracted values, and keeps reviewedAt", () => {
    const report = buildExtractionAccuracyReport([
      row(
        "inv-1",
        { invoiceNumber: "INV-9", supplierName: "Extracted Supplier" },
        { invoiceNumber: null, supplierName: "Reviewed Supplier" },
        "2026-05-01T10:00:00.000Z",
      ),
    ]);

    expect(report.invoices[0]).toMatchObject({
      invoiceNumber: "INV-9",
      supplierName: "Reviewed Supplier",
      reviewedAt: "2026-05-01T10:00:00.000Z",
    });
    expect(headerField(report, "invoiceNumber")).toMatchObject({ cleared: 1 });
    expect(headerField(report, "supplierName")).toMatchObject({ corrected: 1 });
  });
});
