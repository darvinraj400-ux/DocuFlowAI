"use server";

import { createClient } from "@/lib/supabase/server";
import { fieldErrors, resetPasswordSchema } from "@/lib/auth/validation";

export interface SettingsFormState {
  errors?: Record<string, string>;
  global?: string;
  success?: boolean;
  message?: string;
}

const CONFIG_ERROR = "Supabase is not configured. See the README.";

type FormDataLike = Pick<FormData, "get">;

function stringValue(formData: FormDataLike, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

export async function changePasswordAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const password = stringValue(formData, "password");
  const confirmPassword = stringValue(formData, "confirmPassword");

  const errors = fieldErrors(resetPasswordSchema, { password, confirmPassword });
  if (Object.keys(errors).length > 0) return { errors };

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { global: CONFIG_ERROR };
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { global: "You must be signed in to change your password." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const err = error as { status?: number; message?: string };
    if (err.status === 429 || String(err.message ?? "").toLowerCase().includes("rate limit")) {
      return { global: "Too many attempts. Please wait a moment and try again." };
    }
    return { global: "We could not update your password. Please try again." };
  }

  return {
    success: true,
    message: "Password updated. Use your new password the next time you sign in.",
  };
}
