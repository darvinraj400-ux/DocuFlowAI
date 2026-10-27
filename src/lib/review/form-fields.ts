import type { ExtractionResult, LineItem } from "@/lib/pipeline/schema";

export const EMPTY_LINE: LineItem = {
  description: "",
  quantity: "",
  unitPrice: "",
  taxAmount: "",
  lineTotal: "",
};

export interface ReviewLineItem extends LineItem {
  /**
   * Index of this row in the server-rendered effective line-item array, used
   * server-side to re-attach unknown extraction fields. New rows use `null`.
   */
  sourceIndex?: number | null;
}

export type ReviewFormValue = Omit<ExtractionResult, "lineItems"> & {
  lineItems: ReviewLineItem[];
};

/**
 * Serializes every control the review form renders. Keep this in sync with
 * `parseReviewForm`: fields not serialized here are treated as untouched and
 * retain their extracted value.
 */
export function buildReviewFormData(value: Partial<ReviewFormValue>): FormData {
  const fd = new FormData();
  const set = (key: string, val: string | null | undefined) =>
    fd.set(key, val == null ? "" : String(val));

  set("supplierName", value.supplierName);
  set("supplierTaxId", value.supplierTaxId);
  set("invoiceNumber", value.invoiceNumber);
  set("invoiceDate", value.invoiceDate);
  set("dueDate", value.dueDate);
  set("currencyCode", value.currencyCode);
  set("subtotal", value.subtotal);
  set("taxTotal", value.taxTotal);
  set("total", value.total);
  set("paymentTerms", value.paymentTerms);
  set("documentType", value.documentType);
  set("orderNumber", value.orderNumber);
  set("buyerName", value.buyerName);
  set("buyerTaxId", value.buyerTaxId);
  set("shippingCost", value.shippingCost);
  set("amountPaid", value.amountPaid);
  set("balanceDue", value.balanceDue);
  set("amountDiscounted", value.amountDiscounted);

  (value.lineItems ?? []).forEach((line, i) => {
    set(`li_${i}_sourceIndex`, line.sourceIndex == null ? "" : String(line.sourceIndex));
    set(`li_${i}_description`, line.description);
    set(`li_${i}_productCode`, line.productCode);
    set(`li_${i}_quantity`, line.quantity);
    set(`li_${i}_unit`, line.unit);
    set(`li_${i}_unitPrice`, line.unitPrice);
    set(`li_${i}_discountRate`, line.discountRate);
    set(`li_${i}_discountAmount`, line.discountAmount);
    set(`li_${i}_taxRate`, line.taxRate);
    set(`li_${i}_taxAmount`, line.taxAmount);
    set(`li_${i}_lineTotal`, line.lineTotal);
  });

  return fd;
}
