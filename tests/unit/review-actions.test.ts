import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { approveAction, saveCorrectionsAction } from "@/lib/review/actions";

const USER_ID = "user-1";
const INVOICE_ID = "inv-1";

function extractedRow() {
  return {
    id: INVOICE_ID,
    status: "needs_review",
    extracted_data: {
      supplierName: "ARGENTO NEUE",
      invoiceNumber: "#0000000001",
      invoiceDate: "2024-12-14",
      currencyCode: "USD",
      subtotal: "93.80",
      taxTotal: "6.07",
      total: "110.67",
      shippingCost: "10.80",
      capture: { coverage: { pagesTotal: 1, pagesProcessed: 1, complete: true } },
      additional_fields: { supplier_ambiguous: true },
    },
  };
}

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
    ...overrides,
  };
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function setupAdmin(row: Record<string, unknown>) {
  let stored = { ...row };
  const updates: Array<Record<string, unknown>> = [];
  const table = {
    select: vi.fn(() => {
      const chain = {
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: stored })),
      };
      return chain;
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      stored = { ...stored, ...payload };
      const chain = {
        eq: vi.fn(() => chain),
      };
      return chain;
    }),
  };
  const admin = {
    from: vi.fn((name: string) => {
      if (name === "invoices") return table;
      return { insert: vi.fn(async () => ({ error: null })) };
    }),
  };
  mocks.createAdminClient.mockReturnValue(admin);
  return { updates, admin };
}

describe("review actions preserve effective data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  });

  it("saveCorrections persists merged reviewed_data and keeps extracted_data untouched", async () => {
    const { updates } = setupAdmin(extractedRow());
    const res = await saveCorrectionsAction(INVOICE_ID, {}, makeForm({ paymentTerms: "Net 60" }));
    expect(res.success).toBe(true);
    expect(updates).toHaveLength(1);
    const payload = updates[0]! as Record<string, unknown>;
    expect((payload.reviewed_data as Record<string, unknown>).paymentTerms).toBe("Net 60");
    expect((payload.reviewed_data as Record<string, unknown>).shippingCost).toBe("10.80");
    expect((payload.reviewed_data as Record<string, unknown>).capture).toBeDefined();
    expect((payload.reviewed_data as Record<string, unknown>).additional_fields).toMatchObject({ supplier_ambiguous: true });
    expect(payload.status).toBeUndefined();
  });

  it("approve validates the effective merged data, not a lossy legacy subset", async () => {
    const { updates } = setupAdmin(extractedRow());
    let error: unknown = null;
    try {
      await approveAction(INVOICE_ID, {}, makeForm());
    } catch (err) {
      error = err;
    }
    // successful approval redirects (throws NEXT_REDIRECT after persisting)
    const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : "";
    expect(digest).toContain("/invoices/inv-1");
    expect(updates).toHaveLength(1);
    const payload = updates[0]! as Record<string, unknown>;
    expect(payload.status).toBe("approved");
    expect((payload.reviewed_data as Record<string, unknown>).shippingCost).toBe("10.80");
  });

  it("approve blocks when merged data genuinely lacks a required total", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).total = null;
    setupAdmin(row);
    const res = await approveAction(INVOICE_ID, {}, makeForm({ total: "" }));
    expect(res.global).toContain("MISSING_TOTAL");
  });

  it("persists added and edited line items in reviewed_data only", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "Extracted item", productCode: "SKU-0", quantity: "1", unitPrice: "5.00", lineTotal: "5.00" },
    ];
    const { updates } = setupAdmin(row);
    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_description: "Edited item",
        li_0_productCode: "SKU-0",
        li_0_quantity: "1",
        li_0_unitPrice: "5.00",
        li_0_lineTotal: "5.00",
        li_1_description: "Added item",
        li_1_quantity: "2",
        li_1_unitPrice: "3.50",
        li_1_lineTotal: "7.00",
      }),
    );

    expect(res.success).toBe(true);
    expect(updates).toHaveLength(1);
    const payload = updates[0]! as Record<string, unknown>;
    expect(payload.extracted_data).toBeUndefined();
    const lines = (payload.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: "Edited item", productCode: "SKU-0" });
    expect(lines[1]).toMatchObject({ description: "Added item", lineTotal: "7.00" });
  });

  it("approve blocks invalid line-item money in the edited data", async () => {
    const { updates } = setupAdmin(extractedRow());
    const res = await approveAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_description: "Widget",
        li_0_quantity: "-1",
        li_0_unitPrice: "5.00",
        li_0_lineTotal: "-5.00",
      }),
    );
    expect(res.global).toContain("NEGATIVE_AMOUNT");
    expect(updates).toHaveLength(0);
  });

  it("preserves unknown line-item fields when a known field is edited", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      {
        description: "Widget",
        productCode: "SKU-1",
        quantity: "1",
        unitPrice: "10.00",
        lineTotal: "10.00",
        vendorSku: "EXT-9",
        attributes: { color: "red" },
      },
    ];
    const { updates } = setupAdmin(row);

    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_sourceIndex: "0",
        li_0_description: "Widget edited",
        li_0_productCode: "SKU-1",
        li_0_quantity: "1",
        li_0_unitPrice: "10.00",
        li_0_lineTotal: "10.00",
      }),
    );

    expect(res.success).toBe(true);
    expect(updates).toHaveLength(1);
    const payload = updates[0]! as Record<string, unknown>;
    expect(payload.extracted_data).toBeUndefined();
    const lines = (payload.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({
      description: "Widget edited",
      vendorSku: "EXT-9",
      attributes: { color: "red" },
    });
    expect(res.lineItems).toHaveLength(1);
    expect(res.lineItems?.[0]).toMatchObject({ description: "Widget edited", vendorSku: "EXT-9" });
    expect(res.lineItems?.[0]).not.toHaveProperty("sourceIndex");
  });

  it("does not move a removed row's unknown fields onto the row that shifts up", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "First", lineTotal: "1.00", batchCode: "A" },
      { description: "Second", lineTotal: "2.00", batchCode: "B" },
    ];
    const { updates } = setupAdmin(row);

    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_sourceIndex: "1",
        li_0_description: "Second",
        li_0_lineTotal: "2.00",
      }),
    );

    expect(res.success).toBe(true);
    const lines = (updates[0]!.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: "Second", batchCode: "B" });
    expect(lines[0]!.batchCode).not.toBe("A");
  });

  it("does not give newly added rows another item's unknown fields", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "Existing", lineTotal: "1.00", batchCode: "A" },
    ];
    const { updates } = setupAdmin(row);

    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_sourceIndex: "0",
        li_0_description: "Existing",
        li_0_lineTotal: "1.00",
        li_1_sourceIndex: "",
        li_1_description: "New",
        li_1_quantity: "2",
        li_1_unitPrice: "3.50",
        li_1_lineTotal: "7.00",
      }),
    );

    expect(res.success).toBe(true);
    const lines = (updates[0]!.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: "Existing", batchCode: "A" });
    expect(lines[1]).toMatchObject({ description: "New", lineTotal: "7.00" });
    expect(Object.prototype.hasOwnProperty.call(lines[1], "batchCode")).toBe(false);
  });

  it("ignores client-submitted unrecognized line properties", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "Widget", lineTotal: "10.00", vendorSku: "SERVER-SIDE" },
    ];
    const { updates } = setupAdmin(row);

    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_sourceIndex: "0",
        li_0_description: "Widget",
        li_0_lineTotal: "10.00",
        li_0_vendorSku: "CLIENT-SIDE",
        li_0_smuggled: "yes",
      }),
    );

    expect(res.success).toBe(true);
    const lines = (updates[0]!.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines[0]!.vendorSku).toBe("SERVER-SIDE");
    expect(Object.prototype.hasOwnProperty.call(lines[0], "smuggled")).toBe(false);
  });

  it("keeps edited known fields and decimal precision exactly", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "Widget", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", batchCode: "A" },
    ];
    const { updates } = setupAdmin(row);

    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        total: "110.6700",
        li_0_sourceIndex: "0",
        li_0_description: "Widget",
        li_0_quantity: "2",
        li_0_unitPrice: "10.125",
        li_0_lineTotal: "20.2500",
      }),
    );

    expect(res.success).toBe(true);
    const reviewed = updates[0]!.reviewed_data as Record<string, unknown>;
    expect(reviewed.total).toBe("110.6700");
    const lines = reviewed.lineItems as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({
      quantity: "2",
      unitPrice: "10.125",
      lineTotal: "20.2500",
      batchCode: "A",
    });
  });

  it("uses the current reviewed data, not extraction, as the preservation source", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "Original", lineTotal: "1.00", batchCode: "EXTRACTED" },
    ];
    (row as Record<string, unknown>).reviewed_data = {
      lineItems: [{ description: "Presaved", lineTotal: "1.00", batchCode: "REVIEWED" }],
    };
    const { updates } = setupAdmin(row);

    const res = await saveCorrectionsAction(
      INVOICE_ID,
      {},
      makeForm({
        li_0_sourceIndex: "0",
        li_0_description: "Edited",
        li_0_lineTotal: "1.00",
      }),
    );

    expect(res.success).toBe(true);
    const lines = (updates[0]!.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({ description: "Edited", batchCode: "REVIEWED" });
  });

  it("preserves unknown line fields on approval and revalidates the merged invoice", async () => {
    const row = extractedRow();
    (row.extracted_data as Record<string, unknown>).lineItems = [
      { description: "Widget", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", batchCode: "A" },
    ];
    const { updates } = setupAdmin(row);

    let error: unknown = null;
    try {
      await approveAction(
        INVOICE_ID,
        {},
        makeForm({
          li_0_sourceIndex: "0",
          li_0_description: "Widget approved",
          li_0_quantity: "1",
          li_0_unitPrice: "10.00",
          li_0_lineTotal: "10.00",
        }),
      );
    } catch (err) {
      error = err;
    }

    const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : "";
    expect(digest).toContain("/invoices/inv-1");
    expect(updates).toHaveLength(1);
    const payload = updates[0]! as Record<string, unknown>;
    expect(payload.extracted_data).toBeUndefined();
    expect(payload.status).toBe("approved");
    const lines = (payload.reviewed_data as Record<string, unknown>).lineItems as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({ description: "Widget approved", batchCode: "A" });
  });
});
