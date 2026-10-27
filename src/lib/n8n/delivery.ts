import "server-only";

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_ATTEMPTS = 3;
export const WEBHOOK_RETRY_BASE_DELAY_MS = 500;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface WebhookDeliveryInput {
  url: string;
  payload: unknown;
  idempotencyKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type WebhookFailureCode = "timeout" | "network_error" | "http_error" | "redirect";

export type WebhookDeliveryResult =
  | { ok: true; attempts: number; status: number }
  | {
      ok: false;
      attempts: number;
      code: WebhookFailureCode;
      status?: number;
      permanent: boolean;
    };

/** Network/timeout, throttling, and server errors may succeed on retry. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POSTs the payload with a per-attempt timeout, bounded exponential backoff,
 * and an idempotency key. Redirects are refused so the payload cannot be
 * forwarded to an unexpected host.
 */
export async function deliverWebhook(input: WebhookDeliveryInput): Promise<WebhookDeliveryResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs ?? WEBHOOK_TIMEOUT_MS));
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS));
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? WEBHOOK_RETRY_BASE_DELAY_MS);
  const sleep = input.sleep ?? defaultSleep;
  const body = JSON.stringify(input.payload);

  let lastFailure: { code: WebhookFailureCode; status?: number } = { code: "network_error" };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "User-Agent": "DocuFlow-AI",
        },
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.status >= 200 && response.status < 300) {
        try {
          await response.body?.cancel();
        } catch {
          // Delivery already succeeded; releasing the body is best effort.
        }
        return { ok: true, attempts: attempt, status: response.status };
      }

      try {
        await response.body?.cancel();
      } catch {
        // Ignore: the status code is all this integration consumes.
      }

      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          attempts: attempt,
          code: "redirect",
          status: response.status,
          permanent: true,
        };
      }

      lastFailure = { code: "http_error", status: response.status };
      const retryable = isRetryableStatus(response.status);
      if (retryable && attempt < maxAttempts) {
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      return {
        ok: false,
        attempts: attempt,
        code: "http_error",
        status: response.status,
        permanent: !retryable,
      };
    } catch {
      clearTimeout(timer);
      lastFailure = { code: controller.signal.aborted ? "timeout" : "network_error" };
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return { ok: false, attempts: attempt, ...lastFailure, permanent: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, attempts: maxAttempts, ...lastFailure, permanent: false };
}
