import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignedViewUrl, assertOwnedStoragePath, INVOICE_BUCKET } from "@/lib/storage";
import { ReviewForm } from "@/components/invoices/review-form";
import { ProcessingStatus } from "@/components/invoices/processing-status";
import { ExtractionInventory } from "@/components/invoices/extraction-inventory";
import { mergeExtractionForReview } from "@/lib/review/merge";
import { buildInvoiceProgress } from "@/lib/invoice-progress";
import type { ValidationFinding, DuplicateFlags, InvoiceStatus } from "@/types/invoice";
import type { ExtractionResult } from "@/lib/pipeline/schema";

export const metadata: Metadata = {
  title: "Invoice review · DocuFlow AI",
};

// This authenticated page blocks on the request (see `connection()` below),
// so navigations into it are intentionally non-instant. Opt out of Instant
// Navigation validation for this segment.
export const instant = false;

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // This authenticated page serves user-specific data and must render at
  // request time — never as a cached static shell. Opt in to request-time
  // rendering before touching the Supabase session client (whose lazy session
  // load uses Date.now(), which is unstable during prerendering).
  await connection();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <div className="text-sm text-muted-foreground">Supabase is not configured. See README.</div>;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !invoice) notFound();

  const admin = createAdminClient();
  let signedUrl: string | null = null;
  try {
    assertOwnedStoragePath(invoice.storage_path, user.id);
    signedUrl = await createSignedViewUrl(admin, INVOICE_BUCKET, invoice.storage_path, 300);
  } catch {
    signedUrl = null;
  }

  const { data: events } = await supabase
    .from("invoice_events")
    .select("event_type,created_at,metadata")
    .eq("invoice_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const extracted = (invoice.extracted_data ?? null) as Partial<ExtractionResult> | null;
  const reviewed = (invoice.reviewed_data ?? null) as Partial<ExtractionResult> | null;
  const initial = mergeExtractionForReview(extracted, reviewed);

  const findings = (invoice.validation_findings ?? []) as ValidationFinding[];
  const duplicateFlags = (invoice.duplicate_flags ?? null) as DuplicateFlags | null;
  const meta = (invoice.extraction_meta ?? {}) as Record<string, unknown>;
  const demo = meta.demo === true;
  const status = invoice.status as InvoiceStatus;
  const reviewable = status === "needs_review" || status === "approved" || status === "rejected";
  const title = reviewable ? "Review invoice" : status === "failed" ? "Processing failed" : "Processing invoice";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {invoice.original_filename} · {status.replace("_", " ")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Original document</h2>
          {signedUrl ? (
            invoice.mime_type === "application/pdf" ? (
              <iframe src={signedUrl} className="h-[520px] w-full rounded-xl border border-border bg-muted/20" title="Invoice document" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signedUrl} alt="Invoice document" className="max-h-[520px] w-full rounded-xl border border-border object-contain" />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Document preview is unavailable.</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border p-4 text-sm">
            <h3 className="text-sm font-medium">Processing & review</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground">
              <dt>Provider</dt><dd className="text-foreground">{String(meta.provider ?? "—")}</dd>
              <dt>Model</dt><dd className="text-foreground">{String(meta.model ?? "—")}</dd>
              <dt>Reviewed by</dt><dd className="text-foreground">{invoice.reviewed_by ? "You" : "Not yet"}</dd>
            </dl>
          </div>

          {reviewable ? (
            <ReviewForm
              invoiceId={id}
              initial={initial}
              findings={findings}
              duplicateFlags={duplicateFlags}
              demo={demo}
              status={status}
            />
          ) : (
            <ProcessingStatus
              invoiceId={id}
              initial={buildInvoiceProgress({
                id: invoice.id,
                status,
                updated_at: invoice.updated_at,
                extraction_meta: invoice.extraction_meta,
                error_info: invoice.error_info,
              })}
            />
          )}

          {events && events.length > 0 && (
            <div className="rounded-xl border border-border p-4 text-sm">
              <h3 className="text-sm font-medium">Audit history</h3>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {events.map((ev, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{ev.event_type.replace("_", " ")}</span>
                    <span className="text-xs">{new Date(ev.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ExtractionInventory extraction={extracted} />
        </div>
      </div>
    </div>
  );
}