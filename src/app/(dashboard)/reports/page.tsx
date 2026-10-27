import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  REPORT_INVOICE_LIMIT,
  buildExtractionAccuracyReport,
  type AccuracyFieldStats,
  type AccuracyInvoiceRow,
  type AccuracyTotals,
} from "@/lib/reports/extraction-accuracy";
import { formatAccuracy } from "@/lib/accuracy/values";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Reports · DocuFlow AI",
};

// This authenticated page blocks on the request (see `connection()` below),
// so navigations into it are intentionally non-instant. Opt out of Instant
// Navigation validation for this segment.
export const instant = false;

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function SetupRequired() {
  return (
    <Alert>
      <AlertTitle>Setup required</AlertTitle>
      <AlertDescription>
        The database schema or Supabase configuration isn&apos;t ready yet, so we can&apos;t
        build the accuracy report. Follow the README to configure Supabase and apply the
        migrations.
      </AlertDescription>
    </Alert>
  );
}

function totalsHint(totals: AccuracyTotals): string {
  if (totals.compared === 0) return "No comparable fields reviewed yet.";
  return `${totals.matches} of ${totals.compared} reviewed field${totals.compared === 1 ? "" : "s"} matched the extraction exactly.`;
}

function FieldTable({ fields, caption }: { fields: AccuracyFieldStats[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Field</th>
            <th className="px-4 py-3 text-right">Compared</th>
            <th className="px-4 py-3 text-right">Exact</th>
            <th className="px-4 py-3 text-right">Corrected</th>
            <th className="px-4 py-3 text-right">Missed</th>
            <th className="px-4 py-3 text-right">Cleared</th>
            <th className="px-4 py-3 text-right">Accuracy</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {fields.map((field) => (
            <tr key={field.key} className={field.compared === 0 ? "text-muted-foreground" : undefined}>
              <td className="px-4 py-2.5">{field.label}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{field.compared}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{field.matches}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{field.corrected}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{field.missed}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{field.cleared}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatAccuracy(field.accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatReviewedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

export default async function ReportsPage() {
  // This authenticated page serves user-specific data and must render at
  // request time — never as a cached static shell. Opt in to request-time
  // rendering before touching the Supabase session client (whose lazy session
  // load uses Date.now(), which is unstable during prerendering).
  await connection();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <SetupRequired />;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  // Read-only report over the reviewer's own approved invoices. RLS also
  // enforces ownership; the explicit filter documents the invariant.
  const { data, error } = await supabase
    .from("invoices")
    .select("id,reviewed_at,extracted_data,reviewed_data")
    .eq("status", "approved")
    .eq("user_id", user.id)
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(REPORT_INVOICE_LIMIT + 1);

  if (error) return <SetupRequired />;

  const report = buildExtractionAccuracyReport((data ?? []) as AccuracyInvoiceRow[], {
    limit: REPORT_INVOICE_LIMIT,
  });

  const headerFields = report.fields.filter((field) => field.group === "header");
  const lineItemFields = report.fields.filter((field) => field.group === "lineItems");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extraction accuracy</h1>
          <p className="text-sm text-muted-foreground">
            How often AI-extracted fields survived human review unchanged.
          </p>
        </div>
        <Link href="/invoices" className={buttonVariants({ variant: "outline" })}>
          View invoices
        </Link>
      </div>

      {report.truncated && (
        <Alert variant="info">
          <AlertTitle>Showing the most recent {REPORT_INVOICE_LIMIT} approved invoices</AlertTitle>
          <AlertDescription>
            Older approved invoices are not included in this report. The limit keeps the
            page responsive; it never fabricates or samples data silently.
          </AlertDescription>
        </Alert>
      )}

      {report.approvedInvoices === 0 ? (
        <Alert variant="info">
          <AlertTitle>No approved invoices yet</AlertTitle>
          <AlertDescription>
            Accuracy is measured against the human-approved snapshot, so this report starts
            once an invoice has been reviewed and approved.{" "}
            <Link href="/invoices" className="underline">
              Review your invoices
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : report.evaluatedInvoices === 0 ? (
        <Alert variant="info">
          <AlertTitle>No comparable reviewed fields</AlertTitle>
          <AlertDescription>
            None of the {report.approvedInvoices} approved invoice
            {report.approvedInvoices === 1 ? "" : "s"} contain reviewed fields this report
            can compare. Approve an invoice through the review form to populate it.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Evaluated invoices"
              value={String(report.evaluatedInvoices)}
              hint={`${report.approvedInvoices} approved invoice${report.approvedInvoices === 1 ? "" : "s"} considered.`}
            />
            <SummaryCard
              label="Overall accuracy"
              value={formatAccuracy(report.totals.accuracy)}
              hint={totalsHint(report.totals)}
            />
            <SummaryCard
              label="Header accuracy"
              value={formatAccuracy(report.header.accuracy)}
              hint={totalsHint(report.header)}
            />
            <SummaryCard
              label="Line-item accuracy"
              value={formatAccuracy(report.lineItems.accuracy)}
              hint={
                report.lineItemsStructureChanged === 0
                  ? totalsHint(report.lineItems)
                  : report.lineItemsStructureChanged === 1
                    ? `${totalsHint(report.lineItems)} 1 invoice was excluded because its line items were added or removed.`
                    : `${totalsHint(report.lineItems)} ${report.lineItemsStructureChanged} invoices were excluded because their line items were added or removed.`
              }
            />
          </div>

          {report.skippedWithoutReviewed > 0 || report.skippedWithoutComparableFields > 0 ? (
            <Alert variant="info">
              <AlertTitle>Some approved invoices could not be scored</AlertTitle>
              <AlertDescription>
                {report.skippedWithoutReviewed > 0 && (
                  <>
                    {report.skippedWithoutReviewed} approved invoice
                    {report.skippedWithoutReviewed === 1 ? " has" : "s have"} no stored
                    reviewed snapshot.{" "}
                  </>
                )}
                {report.skippedWithoutComparableFields > 0 && (
                  <>
                    {report.skippedWithoutComparableFields} approved invoice
                    {report.skippedWithoutComparableFields === 1 ? " has" : "s have"} no
                    comparable reviewed fields.{" "}
                  </>
                )}
                They are excluded from the accuracy figures.
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Header fields</CardTitle>
              <CardDescription>
                Extracted header values compared with the human-approved values. Fields with
                no reviewed value are shown with zero comparisons.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <FieldTable fields={headerFields} caption="Header field accuracy" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line-item fields</CardTitle>
              <CardDescription>
                Line items are compared positionally only when both versions contain the same
                number of rows. Invoices with added or removed rows are excluded and counted
                separately.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <FieldTable fields={lineItemFields} caption="Line-item field accuracy" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evaluated invoices</CardTitle>
              <CardDescription>
                The most recently reviewed approved invoices included in this report.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {report.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No invoices contained comparable fields.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Invoice #</th>
                        <th className="px-4 py-3">Supplier</th>
                        <th className="px-4 py-3">Reviewed</th>
                        <th className="px-4 py-3 text-right">Compared</th>
                        <th className="px-4 py-3 text-right">Corrections</th>
                        <th className="px-4 py-3 text-right">Accuracy</th>
                        <th className="px-4 py-3">Line items</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.invoices.map((invoice) => (
                        <tr key={invoice.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <Link
                              href={`/invoices/${invoice.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {invoice.invoiceNumber ?? "—"}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{invoice.supplierName ?? "—"}</td>
                          <td className="px-4 py-3">{formatReviewedAt(invoice.reviewedAt)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{invoice.compared}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{invoice.corrections}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatAccuracy(invoice.matches / invoice.compared)}
                          </td>
                          <td className="px-4 py-3">
                            {invoice.lineItemsStructureChanged ? (
                              <Badge variant="warning">Structure changed</Badge>
                            ) : (
                              <Badge variant="outline">Compared</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How this report works</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Only approved invoices are included. For each one, the immutable AI output
              (<code>extracted_data</code>) is compared with the human-approved snapshot
              (<code>reviewed_data</code>).
            </li>
            <li>
              A field counts as an exact match when text differs only by case or whitespace,
              money and quantities are numerically equal, and dates match exactly. Fields
              absent from the reviewed snapshot are never scored.
            </li>
            <li>
              A correction is any reviewed value that differs from the extraction. Missed
              and cleared counts show values the extraction omitted or invented.
            </li>
            <li>
              This report is read-only. It does not modify invoices, review decisions, audit
              events, or extraction data, and it respects row-level security.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
