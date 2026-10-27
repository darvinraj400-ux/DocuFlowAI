import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safePath } from "@/lib/auth/site-url";

const ALLOWED_OTP_TYPES = new Set(["signup", "recovery", "email"]);

type OtpType = "signup" | "recovery" | "email";

/**
 * Handles email-confirmation and password-recovery callback links.
 *
 * Supabase templates can link back in two forms:
 *   1. PKCE (default for modern Auth): `?code=<pkce-code>` — exchange it via
 *      `exchangeCodeForSession(code)`, which establishes the session and
 *      persists cookies through the SSR client.
 *   2. Legacy token-hash: `?token_hash=<hash>&type=<otp-type>` — verify via
 *      `verifyOtp({ type, token_hash })`.
 *
 * The `next` destination is normalized with `safePath` (never an open redirect).
 * Successful signups go to /dashboard; recovery goes to /reset-password.
 * We never log query strings containing codes, token hashes, or credentials.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const hasCode = Boolean(code);
  const hasTokenHash = Boolean(tokenHash);
  const hasValidType = type !== null && ALLOWED_OTP_TYPES.has(type);

  let next = safePath(searchParams.get("next"), "/dashboard");
  if (type === "recovery") {
    next = "/reset-password";
  }

  const errorUrl = (reason: string) =>
    new URL(`/error?reason=${encodeURIComponent(reason)}`, request.url);

  // Require exactly one valid callback form.
  const validPkce = hasCode && !hasTokenHash;
  const validTokenHash = hasTokenHash && hasValidType && !hasCode;
  if (!validPkce && !validTokenHash) {
    return NextResponse.redirect(errorUrl("invalid-link"));
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.redirect(errorUrl("not-configured"));
  }

  try {
    if (validPkce) {
      // PKCE flow. `code` is single-use; exchanging it also writes session
      // cookies via the SSR client.
      const { error } = await supabase.auth.exchangeCodeForSession(code!);
      if (error) {
        return NextResponse.redirect(errorUrl("invalid-or-expired"));
      }
    } else {
      const { error } = await supabase.auth.verifyOtp({
        type: type as OtpType,
        token_hash: tokenHash!,
      });
      if (error) {
        return NextResponse.redirect(errorUrl("invalid-or-expired"));
      }
    }
  } catch {
    return NextResponse.redirect(errorUrl("invalid-or-expired"));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
