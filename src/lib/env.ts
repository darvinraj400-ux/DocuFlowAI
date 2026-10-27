import { z } from "zod";

/**
 * Environment configuration.
 *
 * Public variables (NEXT_PUBLIC_*) are safe to expose to the browser and are
 * validated lazily so the app can start before credentials are configured.
 * Server-only variables are never exposed through NEXT_PUBLIC_ variables.
 */

/**
 * Supabase credentials essentials: project URL plus at least one browser-safe
 * key (publishable, or legacy anon as a fallback). This is validated
 * independently of optional public settings so that a malformed optional value
 * (e.g. an invalid `NEXT_PUBLIC_SITE_URL`) never masks Supabase readiness.
 */
const supabasePublicEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .url()
      .describe("Your Supabase project URL, e.g. https://abcdefgh.supabase.co"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .optional()
      .describe("Your Supabase publishable key (safe for the browser)"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z
      .string()
      .optional()
      .describe("Legacy Supabase anon key — accepted as a fallback"),
  })
  .refine(
    (env) =>
      Boolean(
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    {
      message:
        "Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    },
  );

/**
 * The full public schema: Supabase essentials plus optional public settings.
 * Used where complete public configuration is needed. Because the Supabase
 * subset is validated separately, an invalid optional setting here only fails
 * this schema, never the Supabase readiness check.
 */
const publicEnvSchema = supabasePublicEnvSchema.extend({
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
});

export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1)
    .describe("Your Supabase service role key. SERVER ONLY — never expose this."),
  AI_PROVIDER: z
    .enum(["gemini", "mock", "groq"])
    .optional()
    .describe("Extraction provider: gemini (default), mock (explicit demo mode), or groq"),
  GEMINI_API_KEY: z
    .string()
    .optional()
    .describe("Gemini API key. SERVER ONLY."),
  GEMINI_MODEL: z.string().optional(),
  GROQ_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("Groq API key (used when AI_PROVIDER=groq). SERVER ONLY."),
  GROQ_MODEL: z.string().optional(),
  MAX_PDF_PAGES: z.coerce.number().int().positive().optional(),
  MAX_CONCURRENT_PROCESSING: z.coerce.number().int().positive().optional(),
});

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
export const DEFAULT_MAX_PDF_PAGES = 10;
export const DEFAULT_MAX_CONCURRENT_PROCESSING = 3;

export interface AiConfig {
  provider: "gemini" | "mock" | "groq";
  geminiApiKey?: string;
  geminiModel: string;
  groqApiKey?: string;
  groqModel: string;
  maxPdfPages: number;
  maxConcurrentProcessing: number;
}

export function getAiConfig(): AiConfig {
  const env = getServerEnv();
  return {
    provider: env.AI_PROVIDER ?? "gemini",
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    maxPdfPages: env.MAX_PDF_PAGES ?? DEFAULT_MAX_PDF_PAGES,
    maxConcurrentProcessing: env.MAX_CONCURRENT_PROCESSING ?? DEFAULT_MAX_CONCURRENT_PROCESSING,
  };
}

function zodErrorSummary(error: z.ZodError): string {
  return error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
}

/**
 * Reads public env vars via direct, statically analyzable `process.env.X`
 * references. Next.js can only inline NEXT_PUBLIC_* values into client bundles
 * when they are accessed this way — spreading `...process.env` is dynamic and
 * stays undefined in the browser. This function is what feeds the schemas, so
 * the same code path works server- and client-side.
 */
function readPublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };
}

/** Supabase-only credential presence/validity (URL + a key). */
export function getSupabasePublicEnv(): SupabasePublicEnv {
  const result = supabasePublicEnvSchema.safeParse(readPublicEnv());
  if (!result.success) {
    throw new Error(
      `Invalid Supabase environment configuration.\n${zodErrorSummary(result.error)}`,
    );
  }
  return result.data;
}

/** Full public configuration (Supabase + optional settings). */
export function getPublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse(readPublicEnv());
  if (!result.success) {
    throw new Error(
      `Invalid public environment configuration.\n${zodErrorSummary(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Canonical client (browser-safe) Supabase key: publishable key, falling back
 * to the legacy anon key. Uses the Supabase-only validation so an invalid
 * optional public setting cannot break key resolution.
 */
export function getSupabaseKey(): string {
  const env = getSupabasePublicEnv();
  return (
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export function getServerEnv(): z.infer<typeof serverEnvSchema> {
  const result = serverEnvSchema.safeParse({ ...process.env });
  if (!result.success) {
    throw new Error(
      `Missing or invalid server environment variables.\n${zodErrorSummary(result.error)}`,
    );
  }
  return result.data;
}

export { supabasePublicEnvSchema, publicEnvSchema, serverEnvSchema };
