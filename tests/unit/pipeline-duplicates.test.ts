import { describe, expect, it } from "vitest";
import { detectDuplicates } from "@/lib/pipeline/duplicates";

describe("duplicate detection", () => {
  const existing = [
    { id: "a", file_sha256: "hash-a", extracted_data: JSON.parse(JSON.stringify({ normalizedSupplier: "acme", normalizedInvoiceNumber: "INV-1" })) },
    { id: "b", file_sha256: "hash-b", extracted_data: JSON.parse(JSON.stringify({ normalizedSupplier: "other", normalizedInvoiceNumber: "X" })) },
  ];

  it("flags exact file duplicates", () => {
    const flags = detectDuplicates({ fileHash: "hash-a", existing });
    expect(flags.duplicateHash).toBe(true);
    expect(flags.matchedInvoiceId).toBe("a");
  });

  it("flags normalized supplier/invoice-number duplicates", () => {
    const flags = detectDuplicates({ fileHash: "new-hash", supplierKey: "Acme", invoiceNumberKey: "inv-1", existing });
    expect(flags.duplicateNumber).toBe(true);
  });

  it("does not flag distinct invoices", () => {
    const flags = detectDuplicates({ fileHash: "new-hash", supplierKey: "Other Inc", invoiceNumberKey: "Z", existing });
    expect(flags.duplicateHash ?? flags.duplicateNumber).toBeUndefined();
  });
});
