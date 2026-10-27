import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv, getSupabaseKey } from "@/lib/env";

/**
 * Browser-side Supabase client. Uses the public (publishable/anon) key only.
 * Used for authenticated operations that go through RLS (e.g. direct Storage
 * uploads). Any business-critical database mutation should go through a
 * server-side route instead. Never import the admin client here.
 */
export function createClient() {
  const env = getSupabasePublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, getSupabaseKey());
}
