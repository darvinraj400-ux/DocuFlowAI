import { extractionSchema, type ExtractionResult, type LineItem } from "@/lib/pipeline/schema";

function cleanText(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanMoney(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function flattenErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0]?.toString() ?? "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export type ParsedReview =
  | { ok: true; value: ExtractionResult }
  | { ok: false; errors: Record<string, string> };

export function parseReviewForm(formData: FormData): ParsedReview {
  const text = (key: string) => cleanText(formData.get(key));
  const money = (key: string) => cleanMoney(formData.get(key));

  // These are the fields the review form exposes as editable controls. Values
  // are authoritative only when the control exists — blank means the user
  // intentionally cleared the field, absent means untouched.
  const candidate: Partial<ExtractionResult> = {
    supplierName: text("supplierName"),
    supplierTaxId: text("supplierTaxId"),
    invoiceNumber: text("invoiceNumber"),
    invoiceDate: text("invoiceDate"),
    dueDate: text("dueDate"),
    currencyCode: text("currencyCode"),
    subtotal: money("subtotal"),
    taxTotal: money("taxTotal"),
    total: money("total"),
    paymentTerms: text("paymentTerms"),
    documentType: text("documentType"),
    orderNumber: text("orderNumber"),
    buyerName: text("buyerName"),
    buyerTaxId: text("buyerTaxId"),
    shippingCost: money("shippingCost"),
    amountPaid: money("amountPaid"),
    balanceDue: money("balanceDue"),
    amountDiscounted: money("amountDiscounted"),
  };

  const lineItems: LineItem[] = [];
  let index = 0;
  for (;;) {
    if (formData.get(`li_${index}_description`) === null) break;
    lineItems.push({
      description: cleanText(formData.get(`li_${index}_description`)),
      quantity: cleanMoney(formData.get(`li_${index}_quantity`)),
      unitPrice: cleanMoney(formData.get(`li_${index}_unitPrice`)),
      taxAmount: cleanMoney(formData.get(`li_${index}_taxAmount`)),
      lineTotal: cleanMoney(formData.get(`li_${index}_lineTotal`)),
    });
    index += 1;
  }
  candidate.lineItems = lineItems;

  const parsed = extractionSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: flattenErrors(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
