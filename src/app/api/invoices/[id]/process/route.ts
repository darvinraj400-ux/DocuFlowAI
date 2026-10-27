import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueueInvoiceProcessing } from "@/lib/inngest/enqueue";
import type { InvoiceStatus } from "@/types/invoice";

export const maxDuration = 15;

/**
 * Queues durable processing. Auth and ownership stay here; extraction runs in
 * the Inngest worker. The invoice is deliberately left in `uploaded`/`failed`
 * so the worker's atomic claim and status transitions remain authoritative.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { data: invoice, error: lookupError } = await supabase
    .from("invoices")
    .select("id,status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Could not load the invoice." }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const status = invoice.status as InvoiceStatus;
  if (status !== "uploaded" && status !== "failed") {
    return NextResponse.json(
      {
        error:
          status === "processing"
            ? "This invoice is already being processed."
            : "This invoice has already been processed and cannot be queued again.",
      },
      { status: 409 },
    );
  }

  const jobId = crypto.randomUUID();

  try {
    await enqueueInvoiceProcessing({
      invoiceId: id,
      ownerId: user.id,
      jobId,
    });
  } catch (err) {
    // TEMP DIAG: safe fields only. Never log keys, tokens, headers, or file data.
    console.error(
      "[process-diag] enqueue failed " +
        JSON.stringify({
          invoiceId: id,
          status,
          message: err instanceof Error ? err.message : String(err),
        }),
    );
    return NextResponse.json(
      {
        error: "Processing could not be queued. The invoice was not queued — please retry.",
        code: "ENQUEUE_FAILED",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { invoiceId: id, jobId, status: "queued" },
    { status: 202 },
  );
}
