import type { ExtractionResult } from "@/lib/pipeline/schema";

export interface NormalizedKeys {
  supplierKey: string | null;
  invoiceNumberKey: string | null;
  currencyCode: string | null;
}

export function normalizeSupplier(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeInvoiceNumber(num: string | null | undefined): string | null {
  if (!num) return null;
  return num.trim().replace(/\s+/g, "").toUpperCase();
}

export function normalizeCurrency(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.trim().toUpperCase();
}

export function deriveDuplicateKeys(result: ExtractionResult): NormalizedKeys {
  return {
    supplierKey: normalizeSupplier(result.supplierName),
    invoiceNumberKey: normalizeInvoiceNumber(result.invoiceNumber),
    currencyCode: normalizeCurrency(result.currencyCode),
  };
}

/**
 * The canonical persisted `extracted_data` payload: the original extraction
 * plus derived normalization keys used for duplicate detection. The raw
 * extraction fields are preserved unchanged.
 */
export function toStoredExtraction(result: ExtractionResult): Record<string, unknown> {
  const keys = deriveDuplicateKeys(result);
  return {
    ...result,
    normalizedSupplier: keys.supplierKey,
    normalizedInvoiceNumber: keys.invoiceNumberKey,
    normalizedCurrency: keys.currencyCode,
  };
}
