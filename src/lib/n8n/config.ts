import "server-only";
import { z } from "zod";

export interface N8nConfig {
  enabled: boolean;
  webhookUrl?: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrlSchema = z
  .string()
  .url()
  .refine(isHttpUrl, "N8N_WEBHOOK_URL must use http or https.");

/**
 * Deliberately separate from the shared server environment schema: the webhook
 * is optional, so a missing or malformed URL disables only this integration
 * instead of preventing the app — or invoice approval — from working.
 */
export function getN8nConfig(): N8nConfig {
  const raw = process.env.N8N_WEBHOOK_URL?.trim();
  if (!raw) return { enabled: false };

  const parsed = httpUrlSchema.safeParse(raw);
  if (!parsed.success) {
    // Never include the configured value: webhook URLs commonly embed secrets.
    console.warn("[n8n] N8N_WEBHOOK_URL is invalid; webhook delivery is disabled.");
    return { enabled: false };
  }

  return { enabled: true, webhookUrl: parsed.data };
}
