import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv, getSupabaseKey } from "@/lib/env";

/**
 * Server-side Supabase client bound to the request's cookie session.
 * Use inside Route Handlers, Server Actions, and Server Components to read the
 * authenticated user. This client respects RLS.
 */
export async function createClient() {
  const env = getSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getSupabaseKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component; cookies cannot be set here.
            // This is expected and safe to ignore.
          }
        },
      },
    },
  );
}
