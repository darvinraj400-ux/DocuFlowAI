"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseReviewForm } from "@/lib/review/parse";
import { mergeExtractionForReview } from "@/lib/review/merge";
import { preserveUnknownLineItemFields } from "@/lib/review/line-items";
import { captureCoverageFindings, materialConflictFindings, validateExtraction, hasErrorFindings } from "@/lib/pipeline/validate";
import type { ExtractionResult, LineItem } from "@/lib/pipeline/schema";

export interface ReviewFormState {
  errors?: Record<string, string>;
  global?: string;
  success?: boolean;
  message?: string;
  lineItems?: LineItem[];
}

const CONFIG_ERROR = "Supabase is not configured. See the README.";

type FormDataLike = Pick<FormData, "get">;
function stringValue(formData: FormDataLike, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

async function requireOwnedInvoice(invoiceId: string) {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { error: CONFIG_ERROR };
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Unauthorized." };

  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select("id,status,extracted_data,reviewed_data")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status !== "needs_review") {
    return { error: "This invoice is not awaiting review." };
  }

  return { user, admin, invoice };
}

export async function saveCorrectionsAction(
  invoiceId: string,
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const parsed = parseReviewForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  const owned = await requireOwnedInvoice(invoiceId);
  if ("error" in owned) return { global: owned.error };

  const extracted = owned.invoice?.extracted_data as Partial<ExtractionResult> | null | undefined;
  const reviewed = owned.invoice?.reviewed_data as Partial<ExtractionResult> | null | undefined;
  const source = mergeExtractionForReview(extracted, reviewed);
  const effective = mergeExtractionForReview(extracted, parsed.value);
  effective.lineItems = preserveUnknownLineItemFields(
    source.lineItems ?? [],
    effective.lineItems ?? [],
    parsed.lineSources,
  );

  const { error } = await owned.admin
    .from("invoices")
    .update({ reviewed_data: effective })
    .eq("id", invoiceId)
    .eq("user_id", owned.user!.id);

  if (error) return { global: "Could not save your corrections. Please try again." };

  try {
    await owned.admin.from("invoice_events").insert({
      invoice_id: invoiceId,
      actor: owned.user!.id,
      event_type: "status_changed",
      metadata: { action: "corrections_saved" },
    });
  } catch {
    // non-fatal
  }

  return {
    success: true,
    message: "Corrections saved. The invoice remains awaiting review.",
    lineItems: effective.lineItems ?? [],
  };
}

export async function approveAction(
  invoiceId: string,
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const parsed = parseReviewForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  const owned = await requireOwnedInvoice(invoiceId);
  if ("error" in owned) return { global: owned.error };

  const extracted = owned.invoice?.extracted_data as Partial<ExtractionResult> | null | undefined;
  const reviewed = owned.invoice?.reviewed_data as Partial<ExtractionResult> | null | undefined;
  const source = mergeExtractionForReview(extracted, reviewed);
  const effective = mergeExtractionForReview(extracted, parsed.value);
  effective.lineItems = preserveUnknownLineItemFields(
    source.lineItems ?? [],
    effective.lineItems ?? [],
    parsed.lineSources,
  );

  const findings = [
    ...validateExtraction(effective as ExtractionResult),
    ...captureCoverageFindings(effective as ExtractionResult),
    ...materialConflictFindings(effective as ExtractionResult),
  ];
  if (hasErrorFindings(findings)) {
    const blocked = findings.filter((f) => f.severity === "error").map((f) => f.code).join(", ");
    return { global: `Approval blocked by unresolved issues: ${blocked}. Fix these fields first.` };
  }

  const now = new Date().toISOString();
  const { error } = await owned.admin
    .from("invoices")
    .update({
      status: "approved",
      reviewed_data: effective,
      validation_findings: findings,
      reviewed_by: owned.user!.id,
      reviewed_at: now,
    })
    .eq("id", invoiceId)
    .eq("user_id", owned.user!.id);

  if (error) return { global: "Could not approve the invoice. Please try again." };

  try {
    await owned.admin.from("invoice_events").insert({
      invoice_id: invoiceId,
      actor: owned.user!.id,
      event_type: "approved",
      after_changes: { status: "approved", reviewed_by: owned.user!.id },
    });
  } catch {
    // non-fatal
  }

  redirect(`/invoices/${invoiceId}`);
}

export async function rejectAction(
  invoiceId: string,
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const note = stringValue(formData, "rejectionNote").trim();

  const owned = await requireOwnedInvoice(invoiceId);
  if ("error" in owned) return { global: owned.error };

  const now = new Date().toISOString();
  const { error } = await owned.admin
    .from("invoices")
    .update({
      status: "rejected",
      reviewed_by: owned.user!.id,
      reviewed_at: now,
    })
    .eq("id", invoiceId)
    .eq("user_id", owned.user!.id);

  if (error) return { global: "Could not reject the invoice. Please try again." };

  try {
    await owned.admin.from("invoice_events").insert({
      invoice_id: invoiceId,
      actor: owned.user!.id,
      event_type: "rejected",
      after_changes: { status: "rejected", reviewed_by: owned.user!.id },
      metadata: { rejectionNote: note || null },
    });
  } catch {
    // non-fatal
  }

  redirect(`/invoices/${invoiceId}`);
}
