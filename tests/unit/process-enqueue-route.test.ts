import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/inngest/enqueue", () => ({
  enqueueInvoiceProcessing: mocks.enqueue,
}));

import { POST } from "@/app/api/invoices/[id]/process/route";

const USER_ID = "9e5f2c1a-4b3d-4f6e-8a7b-1c2d3e4f5a6b";
const INVOICE_ID = "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f";

const context = { params: Promise.resolve({ id: INVOICE_ID }) };

function makeRequest(): Request {
  return new Request(`http://localhost/api/invoices/${INVOICE_ID}/process`, { method: "POST" });
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

describe("process enqueue route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.enqueue.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSupabase({ data: null, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("returns 500 when Supabase is not configured", async () => {
    mocks.createClient.mockRejectedValue(new Error("missing env"));

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(500);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the signed-in owner", async () => {
    const { eqCalls } = mockSupabase({ data: { id: INVOICE_ID, status: "uploaded" }, error: null });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(202);
    expect(eqCalls).toContainEqual(["id", INVOICE_ID]);
    expect(eqCalls).toContainEqual(["user_id", USER_ID]);
  });

  it("returns 500 when the invoice lookup fails", async () => {
    mockSupabase({ data: null, error: new Error("db error") });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(500);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("returns 404 when the invoice does not belong to the user", async () => {
    mockSupabase({ data: null, error: null });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(404);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("refuses to enqueue an invoice that is already processing", async () => {
    mockSupabase({ data: { id: INVOICE_ID, status: "processing" }, error: null });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(409);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("refuses to enqueue an invoice that is already processed", async () => {
    mockSupabase({ data: { id: INVOICE_ID, status: "needs_review" }, error: null });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(409);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues an uploaded invoice and returns a queued acknowledgement", async () => {
    mockSupabase({ data: { id: INVOICE_ID, status: "uploaded" }, error: null });

    const response = await POST(makeRequest(), context);
    expect(response.status).toBe(202);

    const body = (await response.json()) as {
      invoiceId: string;
      jobId: string;
      status: string;
    };
    expect(body.invoiceId).toBe(INVOICE_ID);
    expect(body.status).toBe("queued");
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      ownerId: USER_ID,
      jobId: body.jobId,
    });
  });

  it("allows retrying a failed invoice", async () => {
    mockSupabase({ data: { id: INVOICE_ID, status: "failed" }, error: null });

    const response = await POST(makeRequest(), context);

    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("never reports queued when the enqueue fails", async () => {
    mockSupabase({ data: { id: INVOICE_ID, status: "uploaded" }, error: null });
    mocks.enqueue.mockRejectedValue(new Error("inngest unreachable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await POST(makeRequest(), context);
      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: "ENQUEUE_FAILED" });
      expect(body.status).toBeUndefined();
      expect(String(body.error)).toContain("not queued");
    } finally {
      errorSpy.mockRestore();
    }
  });

});
