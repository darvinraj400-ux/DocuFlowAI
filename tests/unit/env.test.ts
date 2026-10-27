import { afterEach, describe, expect, it } from "vitest";
import {
  getAiConfig,
  getSupabaseKey,
  getSupabasePublicEnv,
  publicEnvSchema,
  serverEnvSchema,
  supabasePublicEnvSchema,
} from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("environment schemas", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  };

  describe("supabasePublicEnvSchema", () => {
    it("accepts URL + publishable key", () => {
      const parsed = supabasePublicEnvSchema.parse({
        ...base,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_testkey",
      });
      expect(parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publish_testkey");
    });

    it("accepts URL + legacy anon key", () => {
      const parsed = supabasePublicEnvSchema.parse({
        ...base,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_anon_testkey",
      });
      expect(parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_anon_testkey");
    });

    it("rejects when the URL is missing", () => {
      expect(() =>
        supabasePublicEnvSchema.parse({
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_testkey",
        }),
      ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    });

    it("rejects when both public key variables are missing", () => {
      expect(() => supabasePublicEnvSchema.parse({ ...base })).toThrow(
        /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
      );
    });

    it("rejects a non-URL Supabase URL", () => {
      expect(() =>
        supabasePublicEnvSchema.parse({
          NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_testkey",
        }),
      ).toThrow();
    });
  });

  describe("getSupabasePublicEnv / getSupabaseKey", () => {
    function withEnv(extra: Record<string, string>) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = extra.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
      if (extra.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = extra.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      } else {
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      }
      if (extra.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = extra.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      } else {
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      }
      if ("NEXT_PUBLIC_SITE_URL" in extra) {
        process.env.NEXT_PUBLIC_SITE_URL = extra.NEXT_PUBLIC_SITE_URL;
      }
    }

    it("prefers the publishable key when both are present", () => {
      withEnv({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_1",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_anon_2",
      });
      expect(getSupabaseKey()).toBe("sb_publish_1");
      expect(getSupabasePublicEnv()).toMatchObject({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_1",
      });
    });

    it("falls back to the anon key when publishable is absent", () => {
      withEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_anon_3" });
      expect(getSupabaseKey()).toBe("sb_anon_3");
    });

    it("is NOT disturbed by an invalid optional SITE_URL (regression)", () => {
      withEnv({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_4",
        NEXT_PUBLIC_SITE_URL: "not-a-valid-url",
      });
      // Supabase readiness must still be TRUE even though SITE_URL is invalid.
      expect(() => getSupabasePublicEnv()).not.toThrow();
      expect(getSupabaseKey()).toBe("sb_publish_4");
    });

    it("throws when the URL is missing", () => {
      withEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_5",
      });
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(() => getSupabasePublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    });

    it("throws when both public key variables are missing", () => {
      withEnv({});
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      expect(() => getSupabasePublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    });
  });

  describe("full publicEnvSchema still includes optional SITE_URL", () => {
    it("accepts a valid SITE_URL", () => {
      const parsed = publicEnvSchema.parse({
        ...base,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_6",
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
      });
      expect(parsed.NEXT_PUBLIC_SITE_URL).toBe("https://app.example.com");
    });

    it("rejects an invalid SITE_URL at the full-schema level", () => {
      expect(() =>
        publicEnvSchema.parse({
          ...base,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publish_7",
          NEXT_PUBLIC_SITE_URL: "not-a-valid-url",
        }),
      ).toThrow(/NEXT_PUBLIC_SITE_URL/);
    });
  });

  describe("server schema", () => {
    it("requires the service-role key", () => {
      expect(() => serverEnvSchema.parse({})).toThrow();
      expect(() => serverEnvSchema.parse({ SUPABASE_SERVICE_ROLE_KEY: "x" })).not.toThrow();
    });

    it("accepts groq provider configuration with its key", () => {
      const parsed = serverEnvSchema.parse({
        SUPABASE_SERVICE_ROLE_KEY: "x",
        AI_PROVIDER: "groq",
        GROQ_API_KEY: "gq_xxx",
        GROQ_MODEL: "qwen/qwen3.8-27b",
      });
      expect(parsed.AI_PROVIDER).toBe("groq");
      expect(parsed.GROQ_API_KEY).toBe("gq_xxx");
      expect(parsed.GROQ_MODEL).toBe("qwen/qwen3.8-27b");
    });

    it("does not require the groq key when gemini is selected", () => {
      expect(() =>
        serverEnvSchema.parse({
          SUPABASE_SERVICE_ROLE_KEY: "x",
          AI_PROVIDER: "gemini",
          GEMINI_API_KEY: "g",
        }),
      ).not.toThrow();
    });

    it("defaults the groq model to qwen/qwen3.8-27b (multimodal)", () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
      process.env.AI_PROVIDER = "groq";
      process.env.GROQ_API_KEY = "gq_xxx";
      delete process.env.GROQ_MODEL;
      expect(getAiConfig().groqModel).toBe("qwen/qwen3.8-27b");
    });
  });
});
