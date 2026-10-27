import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildInvoiceProgress } from "@/lib/invoice-progress";
import type { InvoiceStatus } from "@/types/invoice";

/**
 * Authenticated, ownership-checked progress for the upload/detail UI. Uses the
 * RLS-bound cookie client (never the service role) and pins the query to the
 * signed-in user as defense in depth.
 */
export async function GET(
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

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id,status,updated_at,extraction_meta,error_info")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load invoice status." }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  return NextResponse.json(
    buildInvoiceProgress({
      id: invoice.id,
      status: invoice.status as InvoiceStatus,
      updated_at: invoice.updated_at,
      extraction_meta: invoice.extraction_meta,
      error_info: invoice.error_info,
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
