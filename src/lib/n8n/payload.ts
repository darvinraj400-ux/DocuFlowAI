import type { ExtractionResult } from "@/lib/pipeline/schema";
import { mergeExtractionForReview } from "@/lib/review/merge";

export const APPROVED_INVOICE_WEBHOOK_EVENT = "invoice.approved";

export interface ApprovedInvoiceLineItemPayload {
  description: string | null;
  productCode: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

/**
 * The documented webhook payload. Only explicitly allowlisted invoice fields
 * are included — never the stored file, storage path, owner account, contact
 * details, bank/payment details, raw extraction JSON, or audit metadata.
 */
export interface ApprovedInvoicePayload {
  event: typeof APPROVED_INVOICE_WEBHOOK_EVENT;
  invoice: {
    id: string;
    invoiceNumber: string | null;
    supplierName: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    currencyCode: string | null;
    subtotal: string | null;
    taxTotal: string | null;
    shippingCost: string | null;
    total: string | null;
    paymentTerms: string | null;
    approvedAt: string;
    lineItems: ApprovedInvoiceLineItemPayload[];
  };
}

export interface ApprovedInvoiceSource {
  id: string;
  extracted_data: unknown;
  reviewed_data: unknown;
  reviewed_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asDecimal(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asIsoTimestamp(value: unknown): string | null {
  const text = asText(value);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return text;
}

function toLineItem(value: unknown): ApprovedInvoiceLineItemPayload | null {
  if (!isRecord(value)) return null;
  return {
    description: asText(value.description),
    productCode: asText(value.productCode),
    quantity: asDecimal(value.quantity),
    unitPrice: asDecimal(value.unitPrice),
    lineTotal: asDecimal(value.lineTotal),
  };
}

/** Builds the allowlisted payload from the human-approved effective data. */
export function buildApprovedInvoicePayload(
  invoice: ApprovedInvoiceSource,
  fallbackApprovedAt: string,
): ApprovedInvoicePayload {
  const merged = mergeExtractionForReview(
    isRecord(invoice.extracted_data)
      ? (invoice.extracted_data as Partial<ExtractionResult>)
      : null,
    isRecord(invoice.reviewed_data)
      ? (invoice.reviewed_data as Partial<ExtractionResult>)
      : null,
  );

  const lineItems = Array.isArray(merged.lineItems)
    ? merged.lineItems
        .map(toLineItem)
        .filter((item): item is ApprovedInvoiceLineItemPayload => item !== null)
    : [];

  return {
    event: APPROVED_INVOICE_WEBHOOK_EVENT,
    invoice: {
      id: invoice.id,
      invoiceNumber: asText(merged.invoiceNumber),
      supplierName: asText(merged.supplierName),
      invoiceDate: asText(merged.invoiceDate),
      dueDate: asText(merged.dueDate),
      currencyCode: asText(merged.currencyCode),
      subtotal: asDecimal(merged.subtotal),
      taxTotal: asDecimal(merged.taxTotal),
      shippingCost: asDecimal(merged.shippingCost),
      total: asDecimal(merged.total),
      paymentTerms: asText(merged.paymentTerms),
      approvedAt: asIsoTimestamp(invoice.reviewed_at) ?? fallbackApprovedAt,
      lineItems,
    },
  };
}
