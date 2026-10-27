import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceStatus } from "@/types/invoice";
import {
  INVOICE_PAGE_SIZE,
  MAX_INVOICE_SEARCH_LENGTH,
  buildInvoiceSearchFilter,
  buildInvoicesHref,
  parseInvoiceListFilters,
} from "@/lib/invoices/filters";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = {
  title: "Invoices · DocuFlow AI",
};

// This authenticated page blocks on the request (see `connection()` below),
// so navigations into it are intentionally non-instant. Opt out of Instant
// Navigation validation for this segment.
export const instant = false;

const STATUS_FILTERS: Array<{ value: InvoiceStatus | ""; label: string }> = [
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const filters = parseInvoiceListFilters(rawParams);
  const offset = (filters.page - 1) * INVOICE_PAGE_SIZE;

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

  let query = supabase
    .from("invoices")
    .select(
      "id,status,created_at,original_filename,extracted_data,reviewed_data",
      { count: "exact" },
    )
    .eq("user_id", user.id);
  if (filters.status) query = query.eq("status", filters.status);
  const searchFilter = buildInvoiceSearchFilter(filters.q);
  if (searchFilter) query = query.or(searchFilter);
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + INVOICE_PAGE_SIZE - 1);

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

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE));
  const displayPage = Math.min(filters.page, totalPages);
  const previousPage = filters.page > 1 ? Math.min(filters.page - 1, totalPages) : null;
  const nextPage = filters.page < totalPages ? filters.page + 1 : null;
  const outOfRange = invoices.length === 0 && total > 0 && filters.page > totalPages;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">Your uploaded and processed invoices.</p>
        </div>
        <Link href="/upload" className={buttonVariants()}>Upload invoice</Link>
      </div>

      <form method="get" action="/invoices" role="search" className="flex flex-wrap items-end gap-2">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="invoice-search" className="text-xs text-muted-foreground">
            Search invoices
          </Label>
          <Input
            id="invoice-search"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={MAX_INVOICE_SEARCH_LENGTH}
            placeholder="Invoice number, supplier, or file name"
            className="mt-1.5"
          />
        </div>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Search
        </button>
        {(filters.q || filters.status) && (
          <Link href={buildInvoicesHref({})} className={buttonVariants({ variant: "ghost" })}>
            Clear filters
          </Link>
        )}
      </form>

      {filters.ignoredStatus && (
        <Alert variant="info">
          <AlertTitle>Unknown status filter</AlertTitle>
          <AlertDescription>
            The status &ldquo;{filters.ignoredStatus}&rdquo; is not recognised, so it was ignored.
          </AlertDescription>
        </Alert>
      )}
      {filters.invalidPage && (
        <Alert variant="info">
          <AlertTitle>Invalid page</AlertTitle>
          <AlertDescription>
            The requested page was not valid, so the first page is shown.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const active = filters.status === filter.value;
          return (
            <Link
              key={filter.value}
              href={buildInvoicesHref({ status: filter.value, q: filters.q })}
              className={buttonVariants({ variant: active ? "default" : "outline", size: "sm" })}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {outOfRange ? (
        <Alert variant="info">
          <AlertTitle>Page out of range</AlertTitle>
          <AlertDescription>
            There are only {totalPages} page{totalPages === 1 ? "" : "s"} of results.{" "}
            <Link
              href={buildInvoicesHref({ status: filters.status, q: filters.q })}
              className="underline"
            >
              Go to the first page
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : invoices.length === 0 ? (
        <Alert variant="info">
          <AlertTitle>{filters.q ? "No matching invoices" : "No invoices"}</AlertTitle>
          <AlertDescription>
            {filters.q
              ? `No invoices match “${filters.q}”${filters.status ? ` with the "${filters.status}" status` : ""}.`
              : filters.status
                ? `No invoices match the "${filters.status}" filter.`
                : "You have not uploaded any invoices yet."}
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
              {invoices.map((inv) => {
                const data = inv.reviewed_data ?? inv.extracted_data;
                const currency = displayField(data, "currencyCode");
                const totalValue = displayField(data, "total");
                return (
                  <tr key={inv.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                        {displayField(data, "invoiceNumber")}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{displayField(data, "supplierName")}</td>
                    <td className="px-4 py-3">{displayField(data, "invoiceDate")}</td>
                    <td className="px-4 py-3">{currency !== "—" ? `${currency} ${totalValue}` : totalValue}</td>
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
          {previousPage ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildInvoicesHref({ status: filters.status, q: filters.q, page: previousPage })}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            Page {displayPage} of {totalPages}
          </span>
          {nextPage ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildInvoicesHref({ status: filters.status, q: filters.q, page: nextPage })}
            >
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
