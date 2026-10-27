import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeMetrics, type InvoiceMetrics } from "@/lib/dashboard/metrics";
import type { InvoiceStatus } from "@/types/invoice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard · DocuFlow AI",
};

// This authenticated page blocks on the request (see `connection()` below),
// so navigations into it are intentionally non-instant. Opt out of Instant
// Navigation validation for this segment.
export const instant = false;

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
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

function EmptyOverview() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Track invoice processing at a glance.</p>
        </div>
        <Link href="/upload" className={buttonVariants()}>Upload an invoice</Link>
      </div>
      <Alert variant="info">
        <AlertTitle>No invoices yet</AlertTitle>
        <AlertDescription>
          Upload your first invoice to begin extraction and review. Metrics below
          honestly show zero — we never fabricate numbers.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total processed" value={0} hint="All invoices uploaded to date." />
        <MetricCard label="Awaiting review" value={0} hint="Extracted invoices needing human review." />
        <MetricCard label="Approved" value={0} hint="Invoices approved by a reviewer." />
        <MetricCard label="Failed" value={0} hint="Jobs that could not complete." />
      </div>
    </div>
  );
}

function SetupOverview() {
  return (
    <Alert>
      <AlertTitle>Setup required</AlertTitle>
      <AlertDescription>
        The database schema or Supabase configuration isn&apos;t ready yet, so we can&apos;t
        show real metrics. Follow the README to configure Supabase and apply the
        migrations. No data is shown until a live query succeeds.
      </AlertDescription>
    </Alert>
  );
}

interface RecentInvoice {
  id: string;
  status: InvoiceStatus;
  created_at: string;
  extracted_data: Record<string, unknown> | null;
  reviewed_data: Record<string, unknown> | null;
}

function field(data: Record<string, unknown> | null, key: string): string {
  const v = data?.[key];
  return typeof v === "string" && v ? v : "—";
}

export default async function DashboardPage() {
  // This authenticated page serves user-specific data and must render at
  // request time — never as a cached static shell. Opt in to request-time
  // rendering before touching the Supabase session client (whose lazy session
  // load uses Date.now(), which is unstable during prerendering).
  await connection();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <SetupOverview />;
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");

  const { data: statusRows, error: statusError } = await supabase.from("invoices").select("status");
  if (statusError) return <SetupOverview />;

  const metrics: InvoiceMetrics = computeMetrics((statusRows as Array<{ status: InvoiceStatus }>).map((r) => r.status));

  if (metrics.total === 0) return <EmptyOverview />;

  const { data: recentRows } = await supabase
    .from("invoices")
    .select("id,status,created_at,extracted_data,reviewed_data")
    .order("created_at", { ascending: false })
    .limit(5);

  const recent = (recentRows ?? []) as RecentInvoice[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Track invoice processing at a glance.</p>
        </div>
        <Link href="/upload" className={buttonVariants()}>Upload an invoice</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total processed" value={metrics.total} hint="All invoices uploaded to date." />
        <MetricCard label="Awaiting review" value={metrics.awaitingReview} hint="Extracted invoices needing human review." />
        <MetricCard label="Approved" value={metrics.approved} hint="Invoices approved by a reviewer." />
        <MetricCard label="Failed" value={metrics.failed} hint="Jobs that could not complete." />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent invoices</CardTitle>
          <CardDescription>Your most recently uploaded invoices.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((inv) => {
                const data = inv.reviewed_data ?? inv.extracted_data;
                const currency = field(data, "currencyCode");
                const total = field(data, "total");
                return (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={`/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                        {field(data, "invoiceNumber")}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {field(data, "supplierName")} · {currency !== "—" ? `${currency} ${total}` : total}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs">
                      {inv.status.replace("_", " ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
