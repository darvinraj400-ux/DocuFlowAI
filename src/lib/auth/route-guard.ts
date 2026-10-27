/**
 * Route classification and authentication redirect decisions.
 *
 * Pure logic kept separate from the Proxy so it can be unit-tested without a
 * request context, and so the Proxy never shares mutable state with rendering.
 */

export type RouteKind = "public" | "guest" | "protected";

const GUEST_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

const PROTECTED_PREFIXES = ["/dashboard", "/upload", "/invoices", "/settings"];

export function resolveRouteKind(pathname: string): RouteKind {
  if (pathname === "/") return "public";
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return "protected";
  }
  if (GUEST_PATHS.includes(pathname)) return "guest";
  return "public";
}

/**
 * Returns the path to redirect to, or null when no redirect is needed.
 * - Protected routes redirect unauthenticated visitors to /login.
 * - Guest routes redirect authenticated users to /dashboard.
 */
export function computeAuthRedirect(input: {
  authenticated: boolean;
  pathname: string;
}): string | null {
  const kind = resolveRouteKind(input.pathname);
  if (kind === "protected" && !input.authenticated) return "/login";
  if (kind === "guest" && input.authenticated) return "/dashboard";
  return null;
}
