import type { DuplicateFlags } from "@/types/invoice";

export interface ExistingInvoiceBrief {
  id: string;
  file_sha256?: string | null;
  extracted_data?: Record<string, unknown> | null;
}

function derivedKeys(record: ExistingInvoiceBrief): { supplierKey?: string; invoiceNumberKey?: string } {
  const data = record.extracted_data;
  if (!data) return {};
  const supplierKey = typeof data.normalizedSupplier === "string" ? data.normalizedSupplier : undefined;
  const invoiceNumberKey = typeof data.normalizedInvoiceNumber === "string" ? data.normalizedInvoiceNumber : undefined;
  return { supplierKey, invoiceNumberKey };
}

/**
 * Deterministic duplicate detection. Safeplicates are flagged for review — they
 * are never deleted or auto-rejected.
 */
export function detectDuplicates(input: {
  fileHash: string;
  supplierKey?: string | null;
  invoiceNumberKey?: string | null;
  existing: ExistingInvoiceBrief[];
}): DuplicateFlags {
  const flags: DuplicateFlags = {};
  const hashMatch = input.existing.find((inv) => inv.file_sha256 === input.fileHash);
  if (hashMatch) {
    flags.duplicateHash = true;
    flags.matchedInvoiceId = hashMatch.id;
  }

  const supplierKey = input.supplierKey?.toLowerCase();
  const invoiceNumberKey = input.invoiceNumberKey?.toUpperCase();

  if (supplierKey && invoiceNumberKey) {
    const numberMatch = input.existing.find((inv) => {
      const keys = derivedKeys(inv);
      return (
        keys.supplierKey?.toLowerCase() === supplierKey &&
        keys.invoiceNumberKey?.toUpperCase() === invoiceNumberKey
      );
    });
    if (numberMatch) {
      flags.duplicateNumber = true;
      flags.matchedInvoiceId = flags.matchedInvoiceId ?? numberMatch.id;
    }
  }

  return flags;
}
