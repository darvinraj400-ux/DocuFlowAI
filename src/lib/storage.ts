import type { SupabaseClient } from "@supabase/supabase-js";

export const INVOICE_BUCKET = "invoices";

export function assertOwnedStoragePath(path: string, userId: string): void {
  if (!path.startsWith(`${userId}/`)) {
    throw new Error("Storage path is not owned by the caller.");
  }
}

/** Short-lived signed URL for viewing a private document after ownership check. */
export async function createSignedViewUrl(
  admin: SupabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error("Could not create a signed document URL.");
  }
  return data.signedUrl;
}
