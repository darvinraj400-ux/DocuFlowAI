import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceStatus } from "@/types/invoice";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Invoices · DocuFlow AI",
};

// This authenticated page blocks on the request (see `connection()` below),
// so navigations into it are intentionally non-instant. Opt out of Instant
// Navigation validation for this segment.
export const instant = false;

const PAGE_SIZE = 10;

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
  { value: "processing", label: "Processing" },
];

function displayField(data: Record<string, unknown> | null, key: string): string {
  const value = data?.[key];
  return typeof value === "string" && value ? value : "—";
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status = "", page = "1" } = await searchParams;
  const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);

  // This authenticated page serves user-specific data and must render at
  // request time — never as a cached static shell. Opt in to request-time
  // rendering before touching the Supabase session client (whose lazy session
  // load uses Date.now(), which is unstable during prerendering).
  await connection();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <DbError />;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const offset = (currentPage - 1) * PAGE_SIZE;

  let query = supabase.from("invoices").select("id,status,created_at,original_filename,extracted_data,reviewed_data", { count: "exact" });
  if (status) query = query.eq("status", status);
  query = query.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  if (error) return <DbError />;

  const invoices = (data ?? []) as Array<{
    id: string;
    status: InvoiceStatus;
    created_at: string;
    original_filename: string;
    extracted_data: Record<string, unknown> | null;
    reviewed_data: Record<string, unknown> | null;
  }>;

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const visible = invoices.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">Your uploaded and processed invoices.</p>
        </div>
        <Link href="/upload" className={buttonVariants()}>Upload invoice</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const active = status === filter.value;
          const href = filter.value ? `?status=${filter.value}` : "/invoices";
          return (
            <Link
              key={filter.value}
              href={href}
              className={buttonVariants({ variant: active ? "default" : "outline", size: "sm" })}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <Alert variant="info">
          <AlertTitle>No invoices</AlertTitle>
          <AlertDescription>
            {status ? `No invoices match the "${status}" filter.` : "You have not uploaded any invoices yet."}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((inv) => {
                const data = inv.reviewed_data ?? inv.extracted_data;
                const currency = displayField(data, "currencyCode");
                const total = displayField(data, "total");
                return (
                  <tr key={inv.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                        {displayField(data, "invoiceNumber")}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{displayField(data, "supplierName")}</td>
                    <td className="px-4 py-3">{displayField(data, "invoiceDate")}</td>
                    <td className="px-4 py-3">{currency !== "—" ? `${currency} ${total}` : total}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">{inv.status.replace("_", " ")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          {currentPage > 1 ? (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${status ? `status=${status}&` : ""}page=${currentPage - 1}`}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
          {currentPage < totalPages ? (
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${status ? `status=${status}&` : ""}page=${currentPage + 1}`}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

function DbError() {
  return (
    <Alert>
      <AlertTitle>Setup required</AlertTitle>
      <AlertDescription>
        The database schema or Supabase configuration isn&apos;t ready yet. Apply the
        migrations and configure Supabase (see README) to see your invoices.
      </AlertDescription>
    </Alert>
  );
}
