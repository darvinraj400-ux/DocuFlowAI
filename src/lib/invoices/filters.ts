import { INVOICE_STATUSES, type InvoiceStatus } from "@/types/invoice";

export const INVOICE_PAGE_SIZE = 10;
export const MAX_INVOICE_SEARCH_LENGTH = 100;
export const MAX_INVOICE_PAGE = 10_000;

export interface InvoiceListFilters {
  q: string;
  status: InvoiceStatus | "";
  page: number;
  /** Raw status value when it was not recognised and therefore ignored. */
  ignoredStatus?: string;
  /** True when a page parameter was present but not a usable positive integer. */
  invalidPage?: boolean;
}

type RawParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Collapses whitespace, strips control characters, and bounds the query length. */
export function sanitizeInvoiceSearch(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_INVOICE_SEARCH_LENGTH)
    .trim();
}

export function parseInvoiceListFilters(raw: RawParams): InvoiceListFilters {
  const q = sanitizeInvoiceSearch(firstValue(raw.q));

  const requestedStatus = firstValue(raw.status).trim();
  const valid = new Set<string>(INVOICE_STATUSES);
  const status = valid.has(requestedStatus) ? (requestedStatus as InvoiceStatus) : "";

  const requestedPage = firstValue(raw.page).trim();
  const parsedPage = /^\d+$/.test(requestedPage) ? Number.parseInt(requestedPage, 10) : Number.NaN;
  const pageValid =
    requestedPage === "" ||
    (Number.isFinite(parsedPage) && parsedPage >= 1 && parsedPage <= MAX_INVOICE_PAGE);

  return {
    q,
    status,
    page: pageValid && requestedPage !== "" ? Math.min(parsedPage, MAX_INVOICE_PAGE) : 1,
    ...(requestedStatus && !status ? { ignoredStatus: requestedStatus.slice(0, 60) } : {}),
    ...(!pageValid ? { invalidPage: true } : {}),
  };
}

/**
 * PostgREST filter values are grammar, not parameters. Values containing
 * commas, parentheses, or quotes would change the filter expression, so every
 * pattern is double-quoted. PostgREST unescapes `\"` and `\\`, so backslashes
 * that must survive into SQL LIKE are doubled here.
 */
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * SQL LIKE treats `%` and `_` as wildcards and `\` as its escape character.
 * Escape them so a user searching for "100%" or "INV_01" gets literal matches.
 * PostgREST's `ilike` also treats `*` as a wildcard; it cannot be escaped, so
 * it intentionally remains a wildcard.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Columns searched by the invoice list text query (displayed + source value). */
export const INVOICE_SEARCH_COLUMNS = [
  "original_filename",
  "extracted_data->>invoiceNumber",
  "extracted_data->>supplierName",
  "reviewed_data->>invoiceNumber",
  "reviewed_data->>supplierName",
] as const;

export function buildInvoiceSearchFilter(q: string): string | null {
  const term = sanitizeInvoiceSearch(q);
  if (!term) return null;
  const pattern = `%${escapeLikePattern(term)}%`;
  return INVOICE_SEARCH_COLUMNS.map(
    (column) => `${column}.ilike.${quotePostgrestValue(pattern)}`,
  ).join(",");
}

export function buildInvoicesHref(input: {
  status?: InvoiceStatus | "";
  q?: string;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (input.status) params.set("status", input.status);
  if (input.q) params.set("q", input.q);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/invoices?${query}` : "/invoices";
}
