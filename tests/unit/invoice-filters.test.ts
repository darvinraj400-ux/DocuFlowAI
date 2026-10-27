import { describe, expect, it } from "vitest";
import {
  MAX_INVOICE_PAGE,
  MAX_INVOICE_SEARCH_LENGTH,
  buildInvoiceSearchFilter,
  buildInvoicesHref,
  parseInvoiceListFilters,
  sanitizeInvoiceSearch,
} from "@/lib/invoices/filters";

describe("invoice list filters", () => {
  it("defaults to all invoices on page one", () => {
    expect(parseInvoiceListFilters({})).toEqual({ q: "", status: "", page: 1 });
  });

  it("trims, collapses, and bounds the search term", () => {
    expect(sanitizeInvoiceSearch("  Acme \n\t Inc.  ")).toBe("Acme Inc.");
    expect(sanitizeInvoiceSearch("a".repeat(MAX_INVOICE_SEARCH_LENGTH + 20))).toHaveLength(
      MAX_INVOICE_SEARCH_LENGTH,
    );
    expect(sanitizeInvoiceSearch("Acme\u0000Inc")).toBe("Acme Inc");
  });

  it("accepts known statuses and ignores unknown ones", () => {
    expect(parseInvoiceListFilters({ status: "approved" }).status).toBe("approved");
    expect(parseInvoiceListFilters({ status: "uploaded" }).status).toBe("uploaded");
    const unknown = parseInvoiceListFilters({ status: "archived" });
    expect(unknown.status).toBe("");
    expect(unknown.ignoredStatus).toBe("archived");
  });

  it("bounds page numbers and reports invalid values", () => {
    expect(parseInvoiceListFilters({ page: "3" }).page).toBe(3);
    expect(parseInvoiceListFilters({ page: "0" })).toMatchObject({ page: 1, invalidPage: true });
    expect(parseInvoiceListFilters({ page: "-2" })).toMatchObject({ page: 1, invalidPage: true });
    expect(parseInvoiceListFilters({ page: "abc" })).toMatchObject({ page: 1, invalidPage: true });
    expect(parseInvoiceListFilters({ page: String(MAX_INVOICE_PAGE + 1) })).toMatchObject({
      page: 1,
      invalidPage: true,
    });
    expect(parseInvoiceListFilters({ page: String(MAX_INVOICE_PAGE) }).page).toBe(MAX_INVOICE_PAGE);
  });

  it("uses the first value when a parameter repeats", () => {
    const filters = parseInvoiceListFilters({ q: ["acme", "other"], status: ["approved", "failed"] });
    expect(filters.q).toBe("acme");
    expect(filters.status).toBe("approved");
  });
});

describe("invoice search filter", () => {
  it("returns null for a blank query", () => {
    expect(buildInvoiceSearchFilter("")).toBeNull();
    expect(buildInvoiceSearchFilter("   ")).toBeNull();
  });

  it("searches number, supplier, and filename across extracted and reviewed data", () => {
    const filter = buildInvoiceSearchFilter("acme")!;
    expect(filter).toContain('original_filename.ilike."%acme%"');
    expect(filter).toContain('extracted_data->>invoiceNumber.ilike."%acme%"');
    expect(filter).toContain('extracted_data->>supplierName.ilike."%acme%"');
    expect(filter).toContain('reviewed_data->>invoiceNumber.ilike."%acme%"');
    expect(filter).toContain('reviewed_data->>supplierName.ilike."%acme%"');
  });

  it("quotes filter grammar characters instead of letting them break the query", () => {
    const filter = buildInvoiceSearchFilter('Acme, "Inc" Co')!;
    expect(filter.startsWith('original_filename.ilike."%Acme, \\"Inc\\" Co%"')).toBe(true);
  });

  it("escapes LIKE wildcards so percent and underscore match literally", () => {
    expect(buildInvoiceSearchFilter("100%")).toContain(
      'original_filename.ilike."%100\\\\%%"',
    );
    expect(buildInvoiceSearchFilter("INV_01")).toContain(
      'original_filename.ilike."%INV\\\\_01%"',
    );
  });

  it("escapes backslashes for both SQL LIKE and PostgREST quoting", () => {
    expect(buildInvoiceSearchFilter("a\\b")).toContain(
      'original_filename.ilike."%a\\\\\\\\b%"',
    );
  });
});

describe("invoice list links", () => {
  it("returns the bare list URL when nothing is set", () => {
    expect(buildInvoicesHref({})).toBe("/invoices");
    expect(buildInvoicesHref({ page: 1 })).toBe("/invoices");
  });

  it("preserves filters and omits page one", () => {
    expect(buildInvoicesHref({ status: "needs_review", q: "acme", page: 1 })).toBe(
      "/invoices?status=needs_review&q=acme",
    );
    expect(buildInvoicesHref({ status: "approved", q: "acme", page: 2 })).toBe(
      "/invoices?status=approved&q=acme&page=2",
    );
  });

  it("URL-encodes the search term", () => {
    expect(buildInvoicesHref({ q: "Acme & Sons" })).toBe("/invoices?q=Acme+%26+Sons");
  });
});
