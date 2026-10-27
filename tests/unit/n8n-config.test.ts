import { afterEach, describe, expect, it, vi } from "vitest";
import { getN8nConfig } from "@/lib/n8n/config";

const ORIGINAL = process.env.N8N_WEBHOOK_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.N8N_WEBHOOK_URL;
  else process.env.N8N_WEBHOOK_URL = ORIGINAL;
  vi.restoreAllMocks();
});

describe("n8n configuration", () => {
  it("is disabled when the URL is unset", () => {
    delete process.env.N8N_WEBHOOK_URL;
    expect(getN8nConfig()).toEqual({ enabled: false });
  });

  it("is disabled for a blank URL", () => {
    process.env.N8N_WEBHOOK_URL = "   ";
    expect(getN8nConfig()).toEqual({ enabled: false });
  });

  it("accepts https and localhost http webhook URLs", () => {
    process.env.N8N_WEBHOOK_URL = "https://n8n.example.com/webhook/docuflow";
    expect(getN8nConfig()).toEqual({
      enabled: true,
      webhookUrl: "https://n8n.example.com/webhook/docuflow",
    });

    process.env.N8N_WEBHOOK_URL = "http://localhost:5678/webhook/docuflow";
    expect(getN8nConfig()).toEqual({
      enabled: true,
      webhookUrl: "http://localhost:5678/webhook/docuflow",
    });
  });

  it("disables malformed or non-http URLs without throwing or logging the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.N8N_WEBHOOK_URL = "not a url with a secret token";

    expect(getN8nConfig()).toEqual({ enabled: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret token");

    process.env.N8N_WEBHOOK_URL = "ftp://n8n.example.com/webhook/docuflow";
    expect(getN8nConfig()).toEqual({ enabled: false });
  });
});
