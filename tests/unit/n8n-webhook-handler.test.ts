import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { N8nConfig } from "@/lib/n8n/config";
import {
  createSendApprovedWebhookHandler,
  type ApprovedWebhookContext,
} from "@/lib/n8n/handler";
import { deliverWebhook, type FetchLike } from "@/lib/n8n/delivery";
import { createSupabaseWebhookStore } from "@/lib/n8n/store";
import {
  FakeSupabaseAdmin,
  seedInvoice,
  type SeededInvoice,
} from "../helpers/fake-supabase";

function scriptedFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch call");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

function makeContext(data: unknown): ApprovedWebhookContext {
  return {
    event: { data },
    step: {
      run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
    },
  };
}

const CONFIG: N8nConfig = {
  enabled: true,
  webhookUrl: "https://n8n.example.com/webhook/docuflow",
};

function makeDeps(fake: FakeSupabaseAdmin, fetchImpl: FetchLike, config: N8nConfig = CONFIG) {
  const store = createSupabaseWebhookStore(fake.asClient());
  const deliver = vi.fn((input) =>
    deliverWebhook({ ...input, fetchImpl, retryDelayMs: 0 }),
  );
  return { config, store, deliver };
}

function eventData(seeded: SeededInvoice, approvedAt = "2026-01-02T03:04:05.000Z") {
  return { invoiceId: seeded.id, ownerId: seeded.ownerId, approvedAt };
}

function seedApproved(fake: FakeSupabaseAdmin): SeededInvoice {
  return seedInvoice(fake, {
    bytes: new Uint8Array([1, 2, 3]),
    status: "approved",
    reviewedAt: "2026-01-02T03:04:05.000Z",
    extractedData: {
      supplierName: "Extracted Supplier",
      invoiceNumber: "INV-77",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      currencyCode: "USD",
      subtotal: "100.00",
      taxTotal: "8.00",
      shippingCost: "2.00",
      total: "110.00",
      paymentTerms: "Net 30",
      lineItems: [
        {
          description: "Widget",
          productCode: "SKU-1",
          quantity: "2",
          unitPrice: "50.00",
          lineTotal: "100.00",
          vendorSku: "VENDOR-ONLY",
        },
      ],
      buyer: { email: "buyer@example.com" },
      paymentDetails: { iban: "DE89370400440532013000" },
      capture: { fullText: "document full text" },
    },
    reviewedData: { supplierName: "Reviewed Supplier" },
  });
}

describe("approved invoice webhook handler", () => {
  it("delivers the allowlisted payload and records a webhook_sent audit event", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([new Response(null, { status: 200 })]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);

    const result = await handler(makeContext(eventData(seeded)));

    expect(result).toEqual({
      status: "sent",
      invoiceId: seeded.id,
      attempts: 1,
      httpStatus: 200,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(CONFIG.webhookUrl);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(`invoice-approved:${seeded.id}`);

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      event: "invoice.approved",
      invoice: {
        id: seeded.id,
        invoiceNumber: "INV-77",
        supplierName: "Reviewed Supplier",
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        currencyCode: "USD",
        subtotal: "100.00",
        taxTotal: "8.00",
        shippingCost: "2.00",
        total: "110.00",
        paymentTerms: "Net 30",
        approvedAt: "2026-01-02T03:04:05.000Z",
        lineItems: [
          {
            description: "Widget",
            productCode: "SKU-1",
            quantity: "2",
            unitPrice: "50.00",
            lineTotal: "100.00",
          },
        ],
      },
    });

    const serialized = String(calls[0]!.init.body);
    for (const forbidden of [
      seeded.storagePath,
      seeded.ownerId,
      "buyer@example.com",
      "DE89370400440532013000",
      "document full text",
      "VENDOR-ONLY",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(fake.rows("invoice_events")).toHaveLength(1);
    expect(fake.rows("invoice_events")[0]).toMatchObject({
      invoice_id: seeded.id,
      actor: seeded.ownerId,
      event_type: "webhook_sent",
      metadata: { httpStatus: 200, attempts: 1 },
    });
  });

  it("skips without touching the database or network when unconfigured", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([]);
    const deps = makeDeps(fake, fetchImpl, { enabled: false });
    const load = vi.spyOn(deps.store, "loadInvoice");
    const handler = createSendApprovedWebhookHandler(() => deps);

    const result = await handler(makeContext(eventData(seeded)));

    expect(result).toEqual({
      status: "skipped",
      invoiceId: seeded.id,
      reason: "not_configured",
    });
    expect(load).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("skips a missing invoice or a mismatched owner", async () => {
    const fake = new FakeSupabaseAdmin();
    const { fetchImpl, calls } = scriptedFetch([]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);

    const missing = await handler(
      makeContext({
        invoiceId: randomUUID(),
        ownerId: randomUUID(),
        approvedAt: "2026-01-02T03:04:05.000Z",
      }),
    );
    expect(missing.status).toBe("skipped");
    expect(missing).toMatchObject({ reason: "not_found" });

    const seeded = seedApproved(fake);
    const wrongOwner = await handler(
      makeContext({ ...eventData(seeded), ownerId: randomUUID() }),
    );
    expect(wrongOwner).toMatchObject({ status: "skipped", reason: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("never sends an invoice that is not approved", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    seeded.row.status = "needs_review";
    const { fetchImpl, calls } = scriptedFetch([]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);

    const result = await handler(makeContext(eventData(seeded)));

    expect(result).toMatchObject({ status: "skipped", reason: "not_approved" });
    expect(calls).toHaveLength(0);
    expect(fake.rows("invoice_events")).toHaveLength(0);
  });

  it("does not send twice when the delivery marker already exists", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([
      new Response(null, { status: 200 }),
      new Response(null, { status: 200 }),
    ]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);

    const first = await handler(makeContext(eventData(seeded)));
    const second = await handler(makeContext(eventData(seeded)));

    expect(first.status).toBe("sent");
    expect(second).toEqual({
      status: "skipped",
      invoiceId: seeded.id,
      reason: "already_sent",
    });
    expect(calls).toHaveLength(1);
    expect(
      fake.rows("invoice_events").filter((event) => event.event_type === "webhook_sent"),
    ).toHaveLength(1);
  });

  it("retries transient failures and records the final attempt count", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([
      new Response(null, { status: 503 }),
      new Response(null, { status: 200 }),
    ]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);

    const result = await handler(makeContext(eventData(seeded)));

    expect(result).toEqual({
      status: "sent",
      invoiceId: seeded.id,
      attempts: 2,
      httpStatus: 200,
    });
    expect(calls).toHaveLength(2);
    expect(fake.rows("invoice_events")[0]).toMatchObject({
      event_type: "webhook_sent",
      metadata: { httpStatus: 200, attempts: 2 },
    });
  });

  it("records a permanent failure without retrying or leaking the URL", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([new Response(null, { status: 400 })]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await handler(makeContext(eventData(seeded)));

      expect(result).toEqual({
        status: "failed",
        invoiceId: seeded.id,
        code: "http_error",
        attempts: 1,
        httpStatus: 400,
      });
      expect(calls).toHaveLength(1);
      expect(fake.rows("invoice_events")[0]).toMatchObject({
        event_type: "status_changed",
        metadata: {
          action: "webhook_delivery_failed",
          code: "http_error",
          httpStatus: 400,
          attempts: 1,
        },
      });

      const logged = String(errorSpy.mock.calls.flat());
      expect(logged).toContain(seeded.id);
      expect(logged).not.toContain(CONFIG.webhookUrl);
      expect(logged).not.toContain("buyer@example.com");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("bounds transient retries and records one terminal failure", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
    ]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await handler(makeContext(eventData(seeded)));

      expect(result).toMatchObject({ status: "failed", attempts: 3 });
      expect(calls).toHaveLength(3);
      expect(
        fake.rows("invoice_events").filter(
          (event) =>
            event.event_type === "status_changed" &&
            (event.metadata as Record<string, unknown>).action === "webhook_delivery_failed",
        ),
      ).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps a successful delivery successful when the audit marker cannot be written", async () => {
    const fake = new FakeSupabaseAdmin();
    const seeded = seedApproved(fake);
    const { fetchImpl, calls } = scriptedFetch([new Response(null, { status: 200 })]);
    const deps = makeDeps(fake, fetchImpl);
    vi.spyOn(deps.store, "recordDelivered").mockRejectedValue(new Error("database unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createSendApprovedWebhookHandler(() => deps);

    try {
      const result = await handler(makeContext(eventData(seeded)));

      expect(result).toMatchObject({ status: "sent", attempts: 1 });
      expect(calls).toHaveLength(1);
      expect(String(errorSpy.mock.calls.flat())).not.toContain("database unavailable");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects malformed events as non-retriable", async () => {
    const fake = new FakeSupabaseAdmin();
    const { fetchImpl, calls } = scriptedFetch([]);
    const deps = makeDeps(fake, fetchImpl);
    const handler = createSendApprovedWebhookHandler(() => deps);

    await expect(
      handler(
        makeContext({
          invoiceId: "not-a-uuid",
          ownerId: randomUUID(),
          approvedAt: "2026-01-02T03:04:05.000Z",
        }),
      ),
    ).rejects.toThrow(/Invalid invoice approved webhook event payload/);
    expect(calls).toHaveLength(0);
  });
});
