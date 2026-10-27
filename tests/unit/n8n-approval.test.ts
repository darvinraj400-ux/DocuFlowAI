import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
}));

vi.mock("@/lib/inngest/enqueue", () => ({
  enqueueInvoiceApprovedWebhook: mocks.enqueue,
}));

import { enqueueApprovedInvoiceWebhook } from "@/lib/n8n/approval";

const ORIGINAL = process.env.N8N_WEBHOOK_URL;

const INPUT = {
  invoiceId: "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f",
  ownerId: "9e5f2c1a-4b3d-4f6e-8a7b-1c2d3e4f5a6b",
  approvedAt: "2026-01-02T03:04:05.000Z",
};

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.N8N_WEBHOOK_URL;
  else process.env.N8N_WEBHOOK_URL = ORIGINAL;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approved webhook enqueue", () => {
  it("does nothing when n8n is not configured", async () => {
    delete process.env.N8N_WEBHOOK_URL;

    const result = await enqueueApprovedInvoiceWebhook(INPUT);

    expect(result).toBe("disabled");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("queues the event when configured", async () => {
    process.env.N8N_WEBHOOK_URL = "https://n8n.example.com/webhook/docuflow";
    mocks.enqueue.mockResolvedValue(undefined);

    const result = await enqueueApprovedInvoiceWebhook(INPUT);

    expect(result).toBe("queued");
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(INPUT);
  });

  it("reports failure without throwing, and never logs the URL or error message", async () => {
    process.env.N8N_WEBHOOK_URL = "https://n8n.example.com/webhook/secret-token";
    mocks.enqueue.mockRejectedValue(
      new Error("connect failed to https://n8n.example.com/webhook/secret-token"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await enqueueApprovedInvoiceWebhook(INPUT);

    expect(result).toBe("failed");
    const logged = String(errorSpy.mock.calls.flat());
    expect(logged).toContain(INPUT.invoiceId);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("connect failed");
  });
});
