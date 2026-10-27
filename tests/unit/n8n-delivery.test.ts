import { describe, expect, it } from "vitest";
import { deliverWebhook, type FetchLike } from "@/lib/n8n/delivery";

function scripted(responses: Array<Response | Error>) {
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

const INPUT = {
  url: "https://n8n.example.com/webhook/docuflow",
  payload: { event: "invoice.approved", invoice: { id: "inv-1" } },
  idempotencyKey: "invoice-approved:inv-1",
  retryDelayMs: 0,
};

describe("n8n webhook delivery", () => {
  it("POSTs JSON with an idempotency key and refuses redirects", async () => {
    const { fetchImpl, calls } = scripted([new Response(null, { status: 200 })]);

    const result = await deliverWebhook({ ...INPUT, fetchImpl });

    expect(result).toEqual({ ok: true, attempts: 1, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(INPUT.url);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.body).toBe(JSON.stringify(INPUT.payload));
    expect(calls[0]!.init.signal).toBeDefined();

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe(INPUT.idempotencyKey);
  });

  it.each([408, 425, 429, 500, 503])(
    "retries transient HTTP status %i",
    async (status) => {
      const { fetchImpl, calls } = scripted([
        new Response(null, { status }),
        new Response(null, { status: 200 }),
      ]);

      const result = await deliverWebhook({ ...INPUT, fetchImpl, retryDelayMs: 250 });

      expect(result).toEqual({ ok: true, attempts: 2, status: 200 });
      expect(calls).toHaveLength(2);
    },
  );

  it("treats a permanent 4xx as final without retrying", async () => {
    const { fetchImpl, calls } = scripted([new Response(null, { status: 400 })]);

    const result = await deliverWebhook({ ...INPUT, fetchImpl });

    expect(result).toEqual({
      ok: false,
      attempts: 1,
      code: "http_error",
      status: 400,
      permanent: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("fails immediately on a redirect instead of forwarding the payload", async () => {
    const { fetchImpl, calls } = scripted([
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }),
    ]);

    const result = await deliverWebhook({ ...INPUT, fetchImpl });

    expect(result).toEqual({
      ok: false,
      attempts: 1,
      code: "redirect",
      status: 302,
      permanent: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("bounds retries and applies exponential backoff", async () => {
    const delays: number[] = [];
    const { fetchImpl, calls } = scripted([
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
    ]);

    const result = await deliverWebhook({
      ...INPUT,
      fetchImpl,
      retryDelayMs: 250,
      maxAttempts: 3,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toEqual({
      ok: false,
      attempts: 3,
      code: "http_error",
      status: 500,
      permanent: false,
    });
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([250, 500]);
  });

  it("retries network errors", async () => {
    const { fetchImpl, calls } = scripted([
      new Error("socket closed"),
      new Response(null, { status: 200 }),
    ]);

    const result = await deliverWebhook({ ...INPUT, fetchImpl });

    expect(result).toEqual({ ok: true, attempts: 2, status: 200 });
    expect(calls).toHaveLength(2);
  });

  it("reports exhausted network errors", async () => {
    const { fetchImpl, calls } = scripted([new Error("dns"), new Error("dns")]);

    const result = await deliverWebhook({ ...INPUT, fetchImpl, maxAttempts: 2 });

    expect(result).toEqual({
      ok: false,
      attempts: 2,
      code: "network_error",
      permanent: false,
    });
    expect(calls).toHaveLength(2);
  });

  it("aborts a hung request at the per-attempt timeout", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });

    const result = await deliverWebhook({
      ...INPUT,
      fetchImpl,
      timeoutMs: 5,
      maxAttempts: 1,
    });

    expect(result).toEqual({
      ok: false,
      attempts: 1,
      code: "timeout",
      permanent: false,
    });
  });

  it("clamps maxAttempts to at least one", async () => {
    const { fetchImpl, calls } = scripted([new Response(null, { status: 200 })]);

    const result = await deliverWebhook({ ...INPUT, fetchImpl, maxAttempts: 0 });

    expect(result).toEqual({ ok: true, attempts: 1, status: 200 });
    expect(calls).toHaveLength(1);
  });
});
