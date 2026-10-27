import type { ExtractionResult, LineItem } from "@/lib/pipeline/schema";
import type { ValueKind } from "@/lib/accuracy/values";

export interface FieldSpec<Key extends string> {
  key: Key;
  label: string;
  kind: ValueKind;
}

export type HeaderFieldSpec = FieldSpec<keyof ExtractionResult & string>;
export type LineItemFieldSpec = FieldSpec<keyof LineItem & string>;
export type TaxFieldSpec = FieldSpec<"name" | "rate" | "amount" | "base">;
export type AmountEntryFieldSpec = FieldSpec<"description" | "amount" | "rate">;

/** Editable header fields shown in the review form, in review order. */
export const HEADER_FIELD_SPECS = [
  { key: "supplierName", label: "Supplier", kind: "text" },
  { key: "supplierTaxId", label: "Supplier tax ID", kind: "text" },
  { key: "invoiceNumber", label: "Invoice number", kind: "text" },
  { key: "invoiceDate", label: "Invoice date", kind: "date" },
  { key: "dueDate", label: "Due date", kind: "date" },
  { key: "currencyCode", label: "Currency", kind: "currency" },
  { key: "subtotal", label: "Subtotal", kind: "money" },
  { key: "taxTotal", label: "Tax total", kind: "money" },
  { key: "total", label: "Total", kind: "money" },
  { key: "paymentTerms", label: "Payment terms", kind: "text" },
  { key: "documentType", label: "Document type", kind: "text" },
  { key: "orderNumber", label: "Order / PO number", kind: "text" },
  { key: "buyerName", label: "Buyer", kind: "text" },
  { key: "buyerTaxId", label: "Buyer tax ID", kind: "text" },
  { key: "shippingCost", label: "Shipping", kind: "money" },
  { key: "amountPaid", label: "Amount paid", kind: "money" },
  { key: "balanceDue", label: "Balance due", kind: "money" },
  { key: "amountDiscounted", label: "Discount", kind: "money" },
] as const satisfies readonly HeaderFieldSpec[];

export const LINE_ITEM_FIELD_SPECS = [
  { key: "description", label: "Description", kind: "text" },
  { key: "productCode", label: "Product code", kind: "text" },
  { key: "quantity", label: "Quantity", kind: "money" },
  { key: "unit", label: "Unit", kind: "text" },
  { key: "unitPrice", label: "Unit price", kind: "money" },
  { key: "discountRate", label: "Discount rate", kind: "money" },
  { key: "discountAmount", label: "Discount amount", kind: "money" },
  { key: "taxRate", label: "Tax rate", kind: "money" },
  { key: "taxAmount", label: "Tax amount", kind: "money" },
  { key: "lineTotal", label: "Line total", kind: "money" },
] as const satisfies readonly LineItemFieldSpec[];

export const TAX_FIELD_SPECS = [
  { key: "name", label: "Tax name", kind: "text" },
  { key: "rate", label: "Tax rate", kind: "money" },
  { key: "amount", label: "Tax amount", kind: "money" },
  { key: "base", label: "Tax base", kind: "money" },
] as const satisfies readonly TaxFieldSpec[];

export const AMOUNT_ENTRY_FIELD_SPECS = [
  { key: "description", label: "Description", kind: "text" },
  { key: "amount", label: "Amount", kind: "money" },
  { key: "rate", label: "Rate", kind: "money" },
] as const satisfies readonly AmountEntryFieldSpec[];
