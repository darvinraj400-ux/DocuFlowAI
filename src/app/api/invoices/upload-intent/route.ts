import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_MIME_TYPES } from "@/lib/providers/types";
import { EXT_TO_MIME, MAX_FILE_SIZE_BYTES } from "@/lib/file-validation";

export const maxDuration = 30;

const uploadIntentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_MIME_TYPES),
  size: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
});

export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = uploadIntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload metadata.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { filename, contentType, size } = parsed.data;

  // Cross-check extension against the declared MIME type server-side.
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (!ext || EXT_TO_MIME[ext] !== contentType) {
    return NextResponse.json({ error: "Filename extension does not match the declared file type." }, { status: 400 });
  }

  const invoiceId = randomUUID();
  const storagePath = `${user.id}/${invoiceId}/original.${ext}`;

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    // TEMP DIAG: safe fields only; never log keys or headers.
    console.error("[upload-intent-diag] admin client error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const { error: insertError } = await admin.from("invoices").insert({
    id: invoiceId,
    user_id: user.id,
    original_filename: filename,
    storage_path: storagePath,
    mime_type: contentType,
    file_size_bytes: size,
    file_sha256: "",
    status: "uploaded",
  });

  if (insertError) {
    return NextResponse.json({ error: "Could not create the invoice record." }, { status: 500 });
  }

  try {
    await admin.from("invoice_events").insert({
      invoice_id: invoiceId,
      actor: user.id,
      event_type: "uploaded",
      metadata: { filename },
    });
  } catch {
    // Audit event failure is non-fatal.
  }

  return NextResponse.json({ invoiceId, storagePath }, { status: 201 });
}
