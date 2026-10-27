import type { ExtractionProvider } from "@/lib/providers/types";
import { GeminiProvider } from "@/lib/providers/gemini";
import { GroqProvider } from "@/lib/providers/groq";
import { MockProvider } from "@/lib/providers/mock";
import { getAiConfig } from "@/lib/env";

/**
 * Explicit provider selection from AI_PROVIDER.
 * There is deliberately NO silent fallback: if the configured provider cannot
 * run, we throw a clear error instead of quietly swapping providers. Mock mode
 * is always explicit and labelled as demo.
 */
export function createProvider(): ExtractionProvider {
  const config = getAiConfig();

  if (config.provider === "mock") {
    return new MockProvider();
  }

  if (config.provider === "gemini") {
    if (!config.geminiApiKey) {
      throw new Error(
        "AI_PROVIDER=gemini requires GEMINI_API_KEY to be set (server-only). " +
          "Use AI_PROVIDER=mock for explicit demo mode.",
      );
    }
    return new GeminiProvider(config.geminiApiKey, config.geminiModel);
  }

  if (config.provider === "groq") {
    if (!config.groqApiKey) {
      throw new Error(
        "AI_PROVIDER=groq requires GROQ_API_KEY to be set (server-only). " +
          "Use AI_PROVIDER=mock for explicit demo mode.",
      );
    }
    return new GroqProvider(config.groqApiKey, config.groqModel);
  }

  throw new Error(`Unknown AI_PROVIDER: ${config.provider}`);
}
