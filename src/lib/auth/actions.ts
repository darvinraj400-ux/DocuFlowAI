"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/auth/site-url";
import {
  fieldErrors,
  forgotPasswordSchema,
  resendConfirmationSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/validation";

export interface AuthFormState {
  errors?: Record<string, string>;
  global?: string;
  success?: boolean;
  message?: string;
  values?: { email?: string };
}

const CONFIG_ERROR =
  "Supabase is not configured. Add the Supabase environment variables (see README) and restart the dev server.";

type FormDataLike = Pick<FormData, "get">;

function stringValue(formData: FormDataLike, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

/** Map a Supabase auth error to a safe, actionable (non-account-leaking) message. */
function safeAuthMessage(error: { status?: number; message?: string }): string {
  const status = error.status;
  const message = (error.message ?? "").toLowerCase();

  // Rate limits / too many requests.
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  // Network / provider outage.
  if (status === 0 || message.includes("fetch") || message.includes("network") || message.includes("timeout")) {
    return "We could not reach the authentication service. Please try again.";
  }
  // Email not confirmed yet.
  if (message.includes("email not confirmed") || message.includes("not confirmed")) {
    return "Please confirm your email address before signing in. Check your inbox for the confirmation link.";
  }
  // Unknown provider errors: keep generic, never reveal whether an account exists.
  return "Unable to complete that request. Please try again.";
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = stringValue(formData, "email");
  const password = stringValue(formData, "password");

  const errors = fieldErrors(signInSchema, { email, password });
  if (Object.keys(errors).length > 0) {
    return { errors, values: { email } };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { global: CONFIG_ERROR };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      global: safeAuthMessage(error),
      values: { email },
    };
  }

  redirect("/dashboard");
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = stringValue(formData, "email");
  const password = stringValue(formData, "password");
  const confirmPassword = stringValue(formData, "confirmPassword");

  const errors = fieldErrors(signUpSchema, { email, password, confirmPassword });
  if (Object.keys(errors).length > 0) {
    return { errors, values: { email } };
  }

  let supabase;
  const siteUrl = await getSiteUrl();
  try {
    supabase = await createClient();
  } catch {
    return { global: CONFIG_ERROR };
  }

  const redirectTo = `${siteUrl}/auth/confirm?next=/dashboard`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      // Do not reveal whether the account exists; keep the generic flow.
      return {
        success: true,
        message: "If that address is new, check your inbox for a confirmation link. Otherwise, sign in with your existing password.",
        values: { email },
      };
    }
    return { global: safeAuthMessage(error), values: { email } };
  }

  // With email confirmation enabled, Supabase returns a user without confirmed
  // identities. Ask the user to confirm before signing in.
  if (data.user) {
    const identities = data.user.identities ?? [];
    if (identities.length === 0) {
      return {
        success: true,
        message: "Check your inbox for a confirmation link, then sign in. If you don\u2019t see it, check your spam folder.",
        values: { email },
      };
    }
  }

  redirect("/dashboard");
}

export interface ResendConfirmationState {
  global?: string;
  success?: boolean;
  message?: string;
}

export async function resendConfirmationAction(
  _prev: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const email = stringValue(formData, "email");
  const errors = fieldErrors(resendConfirmationSchema, { email });
  if (errors.email) {
    return { global: errors.email };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { global: CONFIG_ERROR };
  }

  const siteUrl = await getSiteUrl();
  const emailRedirectTo = `${siteUrl}/auth/confirm?next=/dashboard`;

  try {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo },
    });

    if (error) {
      const status = error.status;
      const message = (error.message ?? "").toLowerCase();
      if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
        return { global: "Too many attempts. Please wait a moment and try again." };
      }
      // Generic and privacy-preserving: never reveal whether the account exists.
      return { global: "We could not send a new confirmation link. Please try again shortly." };
    }
  } catch {
    return { global: "We could not reach the authentication service. Please try again." };
  }

  return {
    success: true,
    message:
      "If that address is registered and unconfirmed, a new confirmation link has been sent. Check your inbox (and spam).",
  };
}

export async function forgotPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = stringValue(formData, "email");
  const errors = fieldErrors(forgotPasswordSchema, { email });
  if (Object.keys(errors).length > 0) {
    return { errors, values: { email } };
  }

  const siteUrl = await getSiteUrl();

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/confirm?next=/reset-password`,
    });
  } catch (error) {
    // Never reveal whether an email is registered. But still surface provider /
    // rate-limit issues as actionable messages.
    const err = error as { status?: number; message?: string } | undefined;
    if (err?.status === 429 || String(err?.message ?? "").toLowerCase().includes("rate limit")) {
      return { global: "Too many attempts. Please wait a moment and try again.", values: { email } };
    }
  }

  return {
    success: true,
    message: "If that email is registered, a password reset link has been sent.",
    values: { email },
  };
}

export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const password = stringValue(formData, "password");
  const confirmPassword = stringValue(formData, "confirmPassword");

  const errors = fieldErrors(resetPasswordSchema, { password, confirmPassword });
  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { global: CONFIG_ERROR };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const err = error as { status?: number; message?: string };
    if (err.status === 429 || String(err.message ?? "").toLowerCase().includes("rate limit")) {
      return { global: "Too many attempts. Please wait a moment and try again." };
    }
    return {
      global: "We could not update your password. The link may have expired or already been used — request a new one.",
    };
  }

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Still navigate home even if sign-out fails.
  }
  redirect("/");
}
