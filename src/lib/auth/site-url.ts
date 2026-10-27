import { headers } from "next/headers";

const DEV_FALLBACK = "http://localhost:3000";

/**
 * Builds this app's canonical origin (no trailing slash) for constructing
 * redirect and email-confirmation URLs. Uses an explicit public site URL when
 * configured, otherwise derives the host from request headers with a localhost
 * fallback. Never trusts a user-supplied redirect destination.
 */
export async function getSiteUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  try {
    const headerStore = await headers();
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    if (!host) return DEV_FALLBACK;
    const proto = (headerStore.get("x-forwarded-proto") ?? "http").split(",")[0]!.trim();
    return `${proto}://${host}`;
  } catch {
    return DEV_FALLBACK;
  }
}

/**
 * Validates a redirect destination so it can never be an open redirect or an
 * absolute external URL. Only same-app paths starting with a single "/" pass.
 */
export function safePath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
