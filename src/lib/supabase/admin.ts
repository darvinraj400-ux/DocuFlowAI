import "server-only";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, getServerEnv } from "@/lib/env";

/**
 * Server-only administrative Supabase client that uses the service-role key.
 * It BYPASSES Row Level Security — the caller is responsible for:
 *   1. authenticating the request,
 *   2. verifying ownership of the affected record,
 *   3. validating the permitted fields, and
 *   4. enforcing valid state transitions.
 * This module must never be imported by client components.
 */
export function createAdminClient() {
  const publicEnv = getSupabasePublicEnv();
  const serverEnv = getServerEnv();

  return createSupabaseAdminClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
