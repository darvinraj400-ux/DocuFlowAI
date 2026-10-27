import type { ExtractionResult } from "@/lib/pipeline/schema";

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface ProviderMeta {
  provider: string;
  model?: string;
  /** True when this was a simulated/demo extraction (mock provider). */
  demo: boolean;
  durationMs: number;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ProviderErrorCode =
  | "invalid_input"
  | "rate_limit"
  | "timeout"
  | "malformed_response"
  | "not_configured"
  | "provider_outage";

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
}

export type ExtractionOutcome =
  | { ok: true; data: ExtractionResult; meta: ProviderMeta }
  | { ok: false; error: ProviderError };

export interface ExtractionInput {
  bytes: Uint8Array;
  mimeType: string;
  /** Document page count from application-side validation, when known. */
  pageCount?: number | null;
}

export interface ExtractionProvider {
  readonly id: string;
  readonly demo: boolean;
  extract(input: ExtractionInput): Promise<ExtractionOutcome>;
}

/** Optional capability for providers that can process a specific page range. */
export interface PageRangedProvider extends ExtractionProvider {
  extractRange(
    input: ExtractionInput,
    range: { from: number; to: number },
  ): Promise<ExtractionOutcome>;
}
