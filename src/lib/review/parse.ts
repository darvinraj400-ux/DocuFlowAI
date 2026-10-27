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
  | { ok: true; value: ExtractionResult; lineSources: Array<number | null> }
  | { ok: false; errors: Record<string, string> };

/** Defensive upper bound for a server action payload; the review UI is far below it. */
const MAX_LINE_ITEMS = 200;

function isBlankLineItem(line: LineItem): boolean {
  return [
    line.description,
    line.productCode,
    line.quantity,
    line.unit,
    line.unitPrice,
    line.discountRate,
    line.discountAmount,
    line.taxRate,
    line.taxAmount,
    line.lineTotal,
  ].every((value) => value == null || value === "");
}

/** Row association token supplied by the form; anything malformed is a new row. */
function parseSourceIndex(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : null;
}

export function parseReviewForm(formData: FormData): ParsedReview {
  const text = (key: string) => cleanText(formData.get(key));
  const money = (key: string) => cleanMoney(formData.get(key));

  // These are the fields the review form exposes as editable controls. Values
  // are authoritative only when the control exists — blank means the user
  // intentionally cleared the field, absent means untouched (so the merge
  // keeps the extracted value).
  const candidate: Record<string, unknown> = {};
  const setText = (key: string) => {
    if (formData.has(key)) candidate[key] = text(key);
  };
  const setMoney = (key: string) => {
    if (formData.has(key)) candidate[key] = money(key);
  };

  for (const key of [
    "supplierName",
    "supplierTaxId",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "currencyCode",
    "paymentTerms",
    "documentType",
    "orderNumber",
    "buyerName",
    "buyerTaxId",
  ]) {
    setText(key);
  }
  for (const key of [
    "subtotal",
    "taxTotal",
    "total",
    "shippingCost",
    "amountPaid",
    "balanceDue",
    "amountDiscounted",
  ]) {
    setMoney(key);
  }

  const rows: Array<{ line: LineItem; sourceIndex: number | null }> = [];
  for (let index = 0; index < MAX_LINE_ITEMS; index += 1) {
    if (formData.get(`li_${index}_description`) === null) break;
    rows.push({
      line: {
        description: cleanText(formData.get(`li_${index}_description`)),
        productCode: cleanText(formData.get(`li_${index}_productCode`)),
        quantity: cleanMoney(formData.get(`li_${index}_quantity`)),
        unit: cleanText(formData.get(`li_${index}_unit`)),
        unitPrice: cleanMoney(formData.get(`li_${index}_unitPrice`)),
        discountRate: cleanMoney(formData.get(`li_${index}_discountRate`)),
        discountAmount: cleanMoney(formData.get(`li_${index}_discountAmount`)),
        taxRate: cleanMoney(formData.get(`li_${index}_taxRate`)),
        taxAmount: cleanMoney(formData.get(`li_${index}_taxAmount`)),
        lineTotal: cleanMoney(formData.get(`li_${index}_lineTotal`)),
      },
      sourceIndex: parseSourceIndex(formData.get(`li_${index}_sourceIndex`)),
    });
  }
  // A blank row is UI scaffolding, not an intentional line item.
  const kept = rows.filter((row) => !isBlankLineItem(row.line));
  candidate.lineItems = kept.map((row) => row.line);

  const parsed = extractionSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: flattenErrors(parsed.error) };
  }
  return { ok: true, value: parsed.data, lineSources: kept.map((row) => row.sourceIndex) };
}
