import { describe, expect, it } from "vitest";
import type { AiConfig } from "@/lib/env";
import { describeProcessingConfig } from "@/lib/settings/processing";

const base: AiConfig = {
  provider: "gemini",
  geminiApiKey: "secret-gemini-key",
  geminiModel: "gemini-test",
  groqApiKey: "secret-groq-key",
  groqModel: "groq-test",
  maxPdfPages: 7,
  maxConcurrentProcessing: 2,
};

describe("settings processing summary", () => {
  it("describes the active Gemini configuration without secrets", () => {
    const view = describeProcessingConfig(base);
    expect(view).toMatchObject({
      provider: "gemini",
      providerLabel: "Google Gemini",
      model: "gemini-test",
      maxPdfPages: 7,
      maxConcurrentProcessing: 2,
      maxUploadMb: 5,
    });
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(Object.keys(view)).not.toContain("geminiApiKey");
    expect(Object.keys(view)).not.toContain("groqApiKey");
  });

  it("describes Groq with its own model", () => {
    const view = describeProcessingConfig({ ...base, provider: "groq" });
    expect(view.providerLabel).toBe("Groq");
    expect(view.model).toBe("groq-test");
  });

  it("labels mock mode as a demo", () => {
    const view = describeProcessingConfig({ ...base, provider: "mock" });
    expect(view.providerLabel).toContain("Mock");
    expect(view.model).toBe("Deterministic fixture");
  });
});
