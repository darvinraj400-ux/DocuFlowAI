import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 15;

/**
 * Recovery helper: marks an incomplete/abandoned invoice as failed (user-owned).
 * Used from the upload UI when a direct-to-storage upload cannot be completed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    // TEMP DIAG: safe fields only; never log keys or headers.
    console.error("[fail-diag] admin client error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const { error } = await admin
    .from("invoices")
    .update({ status: "failed", error_info: { code: "UPLOAD_ABANDONED", message: "Upload was cancelled before it could be processed." } })
    .eq("id", id)
    .eq("user_id", user.id)
    .in("status", ["uploaded", "failed"]);

  if (error) {
    return NextResponse.json({ error: "Could not update the invoice." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}