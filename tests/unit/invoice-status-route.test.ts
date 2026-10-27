import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "@/app/api/invoices/[id]/status/route";

const USER_ID = "9e5f2c1a-4b3d-4f6e-8a7b-1c2d3e4f5a6b";
const INVOICE_ID = "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f";
const context = { params: Promise.resolve({ id: INVOICE_ID }) };

function makeRequest(): Request {
  return new Request(`http://localhost/api/invoices/${INVOICE_ID}/status`);
}

interface LookupResult {
  data: Record<string, unknown> | null;
  error: unknown;
}

function mockSupabase(result: LookupResult) {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return builder;
    },
    maybeSingle: async () => result,
  };
  const from = vi.fn(() => builder);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from,
  });
  return { eqCalls, from };
}

describe("invoice status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase({ data: null, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });

    const response = await GET(makeRequest(), context);

    expect(response.status).toBe(401);
  });

  it("returns 500 when Supabase is not configured", async () => {
    mocks.createClient.mockRejectedValue(new Error("missing env"));

    const response = await GET(makeRequest(), context);

    expect(response.status).toBe(500);
  });

  it("returns 500 when the status lookup fails", async () => {
    mockSupabase({ data: null, error: new Error("db error") });

    const response = await GET(makeRequest(), context);

    expect(response.status).toBe(500);
  });

  it("returns 404 for an invoice the user does not own", async () => {
    const { eqCalls } = mockSupabase({ data: null, error: null });

    const response = await GET(makeRequest(), context);

    expect(response.status).toBe(404);
    expect(eqCalls).toContainEqual(["id", INVOICE_ID]);
    expect(eqCalls).toContainEqual(["user_id", USER_ID]);
  });

  it("returns owner-scoped progress with no-store caching", async () => {
    mockSupabase({
      data: {
        id: INVOICE_ID,
        status: "processing",
        updated_at: "2026-10-27T10:00:00.000Z",
        extraction_meta: {
          _jobId: "job-1",
          _batches: {
            fileSha256: "abc",
            pageCount: 8,
            totalRanges: 3,
            ranges: {
              "1-3": { key: "1-3", ok: true, processedPages: 3 },
              "4-6": { key: "4-6", ok: true, processedPages: 3 },
            },
          },
        },
        error_info: null,
      },
      error: null,
    });

    const response = await GET(makeRequest(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      invoiceId: INVOICE_ID,
      status: "processing",
      phase: "processing",
      terminal: false,
      batchesTotal: 3,
      batchesCompleted: 2,
      pagesTotal: 8,
      pagesProcessed: 6,
    });
  });

  it("reports terminal states so the client stops polling", async () => {
    mockSupabase({
      data: {
        id: INVOICE_ID,
        status: "failed",
        updated_at: "2026-10-27T10:00:00.000Z",
        extraction_meta: {},
        error_info: { code: "EXTRACTION_FAILED", message: "Every batch failed." },
      },
      error: null,
    });

    const response = await GET(makeRequest(), context);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      status: "failed",
      phase: "failed",
      terminal: true,
      message: "Every batch failed.",
    });
  });
});
