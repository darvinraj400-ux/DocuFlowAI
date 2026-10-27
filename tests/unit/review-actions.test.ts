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
});
