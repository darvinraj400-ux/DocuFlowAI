import { describe, expect, it } from "vitest";
import { normalizeExtractionInput, parseExtraction } from "@/lib/pipeline/schema";
import { validateExtraction } from "@/lib/pipeline/validate";
import { groundCaptureCoverage } from "@/lib/pipeline/capture";
import { toStoredExtraction } from "@/lib/pipeline/normalize";

describe("universal extraction schema + normalization", () => {
  it("normalizes the exact previously-failing model output", () => {
    const input = {
      vendor: { name: "ACME Fakturering AB", tax_id: "SE5566778899" },
      customer: { name: "Handelsbolaget AB", address: "Sveavägen 1, Stockholm" },
      invoice_number: "F-2026-00042",
      order_number: "K-98123",
      invoice_date: "2026-03-10",
      due_date: "2026-04-09",
      line_items: [
        { description: "Konsulttjänst", qty: 2, unit_price: 750.0, tax_rate: 25, line_total: 1875.0 },
      ],
      tax: { name: "Moms", rate: 25, amount: 375.0 },
      amount_due: "1875.00",
      payment_details: { method: "Bankgiro", bank_name: "SEB", account_number: "5555-1234" },
    };

    const r = parseExtraction(input);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;

    expect(normalizeExtractionInput(input).seller).toMatchObject({ name: "ACME Fakturering AB", taxId: "SE5566778899" });
    expect(r.value.supplierName).toBe("ACME Fakturering AB");
    expect(r.value.supplierTaxId).toBe("SE5566778899");
    expect(r.value.seller ?? {}).toMatchObject({ name: "ACME Fakturering AB", taxId: "SE5566778899" });
    expect(r.value.buyer).toMatchObject({ name: "Handelsbolaget AB", address: "Sveavägen 1, Stockholm" });
    expect(r.value.invoiceNumber).toBe("F-2026-00042");
    expect(r.value.orderNumber).toBe("K-98123");
    expect(r.value.invoiceDate).toBe("2026-03-10");
    expect(r.value.issueDate).toBe("2026-03-10");
    expect(r.value.dueDate).toBe("2026-04-09");
    expect(r.value.balanceDue).toBe("1875.00");
    expect(r.value.taxes ?? []).toHaveLength(1);
    expect(r.value.taxes?.[0]).toMatchObject({ name: "Moms", rate: "25", amount: "375" });
    expect(r.value.paymentDetails).toMatchObject({ method: "Bankgiro", bankName: "SEB", accountNumber: "5555-1234" });
    expect(r.value.lineItems?.[0]).toMatchObject({
      description: "Konsulttjänst",
      quantity: "2",
      unitPrice: "750",
      taxRate: "25",
      lineTotal: "1875",
    });
    expect(r.value.additional_fields?.raw_input).toEqual(input);
  });

  it("accepts a minimal invoice with all fields missing", () => {
    const r = parseExtraction({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.supplierName).toBeNull();
    expect(r.value.invoiceNumber).toBeNull();
    expect(r.value.lineItems ?? []).toEqual([]);
    expect(r.value.taxes ?? []).toEqual([]);
    expect(r.value.additional_fields?.raw_input).toEqual({});
  });

  it("keeps unknown custom fields and preserves raw input", () => {
    const r = parseExtraction({ supplierName: "A", custom_vendor_field: "x", "local-law-ref": "§12" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.additional_fields?.custom_vendor_field).toBe("x");
      expect(r.value.additional_fields?.["local-law-ref"]).toBe("§12");
    }
  });

  it("supports multiple taxes, currencies, discounts, fees, and rich line items", () => {
    const input = {
      supplierName: "Roofing Ltd",
      invoiceNumber: "INV-77",
      invoiceDate: "2026-01-02",
      currencyCode: "USD",
      subtotal: "1000.00",
      taxTotal: "95.00",
      total: "1090.00",
      currencies: [{ code: "USD", note: "primary" }, { code: "EUR", note: "statement" }],
      taxes: [
        { name: "State tax", rate: "6.00", amount: "60.00", base: "1000.00" },
        { name: "County tax", rate: "3.50", amount: "35.00", base: "1000.00" },
      ],
      discounts: [{ description: "volume", amount: "50.00" }],
      fees: [{ description: "expedite", amount: "10.00" }],
      shippingCost: "15.00",
      amountDiscounted: "50.00",
      amountPaid: "500.00",
      balanceDue: "590.00",
      paymentTerms: "Net 14",
      referenceNumbers: ["R-1", "R-2"],
      lineItems: [
        {
          description: "Roof tiles",
          productCode: "SKU-9",
          quantity: "40",
          unit: "m2",
          unitPrice: "22.50",
          discountRate: "5.00",
          discountAmount: "45.00",
          taxRate: "9.50",
          taxAmount: "85.50",
          lineTotal: "900.00",
        },
      ],
    };

    const r = parseExtraction(input);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect((r.value.currencies ?? []).map((c) => c.code)).toEqual(["USD", "EUR"]);
    expect(r.value.taxes ?? []).toHaveLength(2);
    expect(r.value.discounts?.[0]?.amount).toBe("50.00");
    expect(r.value.fees?.[0]?.amount).toBe("10.00");
    expect(r.value.referenceNumbers ?? []).toEqual(["R-1", "R-2"]);
    expect(r.value.lineItems?.[0]).toMatchObject({ productCode: "SKU-9", unit: "m2", discountRate: "5.00", taxRate: "9.50" });
  });

  it("passes through existing canonical-format invoices unchanged", () => {
    const canonical = {
      supplierName: "Acme",
      supplierTaxId: "GB1",
      invoiceNumber: "INV-1",
      invoiceDate: "2026-05-14",
      dueDate: "2026-06-13",
      currencyCode: "USD",
      subtotal: "100.00",
      taxTotal: "10.00",
      total: "110.00",
      paymentTerms: "Net 30",
      lineItems: [{ description: "Service", quantity: "1", unitPrice: "100.00", taxAmount: "10.00", lineTotal: "110.00" }],
    };
    const r = parseExtraction(canonical);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        supplierName: "Acme",
        invoiceNumber: "INV-1",
        total: "110.00",
      });
    }
  });

  it("preserves unfamiliar nested sub-fields on entities and line items", () => {
    const input = {
      seller: { name: "S", legal_form: "AB", registration: "555555-5555" },
      lineItems: [{ description: "work", internal_note: "rush order" }],
    };
    const r = parseExtraction(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.seller ?? {}).toMatchObject({ legal_form: "AB", registration: "555555-5555" });
      expect(r.value.lineItems?.[0]).toMatchObject({ internal_note: "rush order" });
    }
  });

  it("rejects genuinely invalid types while allowing missing fields", () => {
    expect(parseExtraction({ supplierName: 123 }).ok).toBe(false);
    expect(parseExtraction({ total: true }).ok).toBe(false);
    expect(parseExtraction({ lineItems: [{ quantity: {} }] }).ok).toBe(false);
    expect(parseExtraction({ supplierName: "ok", total: "1.00" }).ok).toBe(true);
  });

  it("preserves the document capture block with per-page coverage and evidence", () => {
    const input = {
      supplierName: "A",
      capture: {
        pages: [
          { page: 1, text: "vendor A", images: 0, extracted: true, truncated: false },
          { page: 2, text: "terms", images: 0, extracted: false, note: "unreadable" },
        ],
        fullText: "vendor A terms",
        coverage: { pagesTotal: 2, pagesProcessed: 1, pagesFailed: 1, complete: false },
        evidence: { supplierName: { page: 1 } },
      },
    };
    const r = parseExtraction(input);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value.capture?.coverage).toMatchObject({ pagesTotal: 2, pagesProcessed: 1, pagesFailed: 1, complete: false });
    expect(r.value.capture?.pages).toHaveLength(2);
    expect(r.value.capture?.pages?.[1]).toMatchObject({ page: 2, extracted: false });
    expect(r.value.capture?.evidence).toMatchObject({ supplierName: { page: 1 } });
    expect(r.value.capture?.fullText).toBe("vendor A terms");
  });

  it("preserves capture, evidence, and unmapped fields through persistence serialization", () => {
    const r = parseExtraction({
      supplierName: "A",
      invoiceNumber: "I-1",
      custom_attr: "keep-me",
      capture: {
        pages: [{ page: 1, text: "a" }],
        fullText: "a",
        coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
        evidence: { invoiceNumber: { page: 1 } },
      },
      lineItems: [{ description: "x", internal_note: "y" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const stored = toStoredExtraction(r.value);
    const revived = JSON.parse(JSON.stringify(stored));

    expect(revived.capture).toMatchObject({
      fullText: "a",
      evidence: { invoiceNumber: { page: 1 } },
      coverage: { pagesTotal: 1, complete: true },
    });
    expect(revived.capture.pages[0]).toMatchObject({ page: 1, text: "a" });
    expect(revived.additional_fields.custom_attr).toBe("keep-me");
    expect(revived.lineItems[0]).toMatchObject({ description: "x", internal_note: "y" });
    expect(revived.normalizedInvoiceNumber).toBe("I-1");
  });

  it("accepts document_capture alias and defaults capture to null when absent", () => {
    const r = parseExtraction({ document_capture: { coverage: { complete: true } } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.capture?.coverage).toMatchObject({ complete: true });
    }
    const empty = parseExtraction({ supplierName: "x" });
    if (empty.ok) expect(empty.value.capture).toBeUndefined();
  });

  it("normalizes the live Groq test invoice without losing canonical fields", () => {
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
      seller: { name: "LuxuryStore", email: "support@luxurystore.example", billing_address: "123 Market St" },
      customer: { name: "Mighty Buyer", email: "buyer@example.com", address: "456 Elm Ave" },
    };

    const r = parseExtraction(raw);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;

    const v = r.value;
    expect(v.supplierName).toBe("ARGENTO NEUE");
    expect(v.invoiceNumber).toBe("#0000000001");
    expect(v.invoiceDate).toBe("2024-12-14");
    expect(v.currencyCode).toBe("USD");
    expect(v.subtotal).toBe("93.80");
    expect(v.taxTotal).toBe("6.07");
    expect(v.total).toBe("110.67");
    expect(v.balanceDue).toBe("110.67");
    expect(v.shippingCost).toBe("10.80");
    expect(v.paymentDetails).toMatchObject({ method: "Check / Money order" });
    expect(v.lineItems).toHaveLength(2);
    expect(v.lineItems?.[0]).toMatchObject({ description: "Luma Analog Watch", quantity: "1", unitPrice: "43.8", lineTotal: "43.8" });
    expect(v.lineItems?.[1]).toMatchObject({ description: "Fusion Backpack", quantity: "1", unitPrice: "50", lineTotal: "50" });
    expect(v.seller).toMatchObject({ name: "LuxuryStore", email: "support@luxurystore.example", address: "123 Market St" });
    expect(v.buyer).toMatchObject({ name: "Mighty Buyer", email: "buyer@example.com", address: "456 Elm Ave" });
    expect(v.additional_fields?.supplier_alternatives).toEqual(["ARGENTO NEUE", "LuxuryStore"]);
    expect(v.additional_fields?.supplier_ambiguous).toBe(true);
    expect(v.additional_fields?.payment_method).toBe("Check / Money order");
    expect(v.additional_fields?.raw_input).toEqual(raw);

    const findings = validateExtraction(v);
    expect(findings.map((f) => f.code)).not.toContain("MISSING_TOTAL");
  });

  it("grounds coverage so a one-page processed document is total and complete", () => {
    const grounded = groundCaptureCoverage(
      { pages: [], fullText: null, coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true } },
      { pageCount: 1, pagesProcessed: 1 },
    );
    expect(grounded.coverage).toMatchObject({ pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true });
  });

  it("does not lose the pagesTotal when only processed pages are known", () => {
    const grounded = groundCaptureCoverage(null, { pagesProcessed: 1 });
    expect(grounded.coverage?.pagesTotal).toBe(1);
    expect(grounded.coverage?.pagesProcessed).toBe(1);
  });

  it("preserves capture and additional fields through JSON persistence round-trip", () => {
    const input = {
      supplierName: "Acme",
      custom_attr: "keep-me",
      capture: {
        pages: [{ page: 1, text: "Acme" }],
        fullText: "Acme",
        coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
        evidence: { supplierName: { page: 1 } },
      },
    };
    const r = parseExtraction(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = JSON.parse(JSON.stringify(r.value));
    expect(stored.capture.coverage.complete).toBe(true);
    expect(stored.capture.pages).toHaveLength(1);
    expect(stored.capture.evidence.supplierName).toEqual({ page: 1 });
    expect(stored.additional_fields.custom_attr).toBe("keep-me");
    expect(stored.additional_fields.raw_input).toBeDefined();
  });
});
