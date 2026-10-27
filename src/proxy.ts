import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv, getSupabaseKey } from "@/lib/env";
import { computeAuthRedirect } from "@/lib/auth/route-guard";

/**
 * Next.js 16 Proxy (successor to middleware).
 *
 * - Refreshes the Supabase session and writes refreshed cookies back to the
 *   response so sessions don't silently expire.
 * - Verifies identity with `getClaims()` (no network round-trip) to decide a
 *   redirect: protect `/dashboard`, and keep signed-in users off guest pages.
 * - If Supabase is not configured, it passes through so the public landing
 *   page still works.
 *
 * The Proxy is a convenience (UX) layer only — it is NOT the security
 * boundary. Server Components, Server Actions, and Route Handlers must verify
 * identity again whenever authorization matters.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  let authenticated = false;
  try {
    const env = getPublicEnv();
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      getSupabaseKey(),
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response = NextResponse.next({ request });
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    const { data } = await supabase.auth.getClaims();
    authenticated = Boolean(data?.claims?.sub);
  } catch {
    // Missing/unavailable configuration — let the app render anyway.
  }

  const pathname = request.nextUrl.pathname;
  const destination = computeAuthRedirect({ authenticated, pathname });

  if (destination) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run everywhere except API routes, framework internals, and static files.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
