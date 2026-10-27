import { getAiConfig, type AiConfig } from "@/lib/env";
import { MAX_FILE_SIZE_BYTES } from "@/lib/file-validation";

/** Safe, read-only view of server processing configuration. Never includes keys. */
export interface ProcessingSettings {
  provider: AiConfig["provider"];
  providerLabel: string;
  model: string;
  maxPdfPages: number;
  maxConcurrentProcessing: number;
  maxUploadMb: number;
  acceptedFormats: string;
}

const PROVIDER_LABELS: Record<AiConfig["provider"], string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  mock: "Mock (demo mode)",
};

export function describeProcessingConfig(config: AiConfig): ProcessingSettings {
  return {
    provider: config.provider,
    providerLabel: PROVIDER_LABELS[config.provider],
    model:
      config.provider === "gemini"
        ? config.geminiModel
        : config.provider === "groq"
          ? config.groqModel
          : "Deterministic fixture",
    maxPdfPages: config.maxPdfPages,
    maxConcurrentProcessing: config.maxConcurrentProcessing,
    maxUploadMb: Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024)),
    acceptedFormats: "PDF, JPEG, PNG",
  };
}

export function getProcessingSettings(): ProcessingSettings | null {
  try {
    return describeProcessingConfig(getAiConfig());
  } catch {
    return null;
  }
}
