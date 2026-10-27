import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  insertInvoice: vi.fn(),
  insertEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { POST } from "@/app/api/invoices/upload-intent/route";

const USER_ID = "user-123";
const VALID_BODY = {
  filename: "invoice.pdf",
  contentType: "application/pdf",
  size: 1024,
};

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/invoices/upload-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_BODY),
  });
}

function mockAdmin() {
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "invoices") {
        return { insert: mocks.insertInvoice };
      }
      if (table === "invoice_events") {
        return { insert: mocks.insertEvent };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.insertInvoice.mockResolvedValue({ error: null });
  mocks.insertEvent.mockResolvedValue({ error: null });
}

describe("upload-intent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mockAdmin();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mocks.insertInvoice).not.toHaveBeenCalled();
  });

  it("inserts the invoice row with the id returned to the client", async () => {
    let insertedPayload: Record<string, unknown> | null = null;
    mocks.insertInvoice.mockImplementation(async (payload: Record<string, unknown>) => {
      insertedPayload = payload;
      return { error: null };
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(insertedPayload).not.toBeNull();
    expect(insertedPayload!.id).toBe(body.invoiceId);
    expect(body.storagePath).toBe(`${USER_ID}/${body.invoiceId}/original.pdf`);
    expect(insertedPayload!.user_id).toBe(USER_ID);
    expect(insertedPayload!.original_filename).toBe(VALID_BODY.filename);
    expect(insertedPayload!.mime_type).toBe(VALID_BODY.contentType);
    expect(insertedPayload!.file_size_bytes).toBe(VALID_BODY.size);
    expect(insertedPayload!.storage_path).toBe(body.storagePath);
  });

  it("returns a generic error when the invoice insert fails", async () => {
    mocks.insertInvoice.mockResolvedValue({ error: new Error("db error") });
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Could not create the invoice record." });
  });
});
