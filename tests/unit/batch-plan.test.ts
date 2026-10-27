import { describe, expect, it } from "vitest";
import {
  BATCH_PAGE_SIZE,
  batchRangeKey,
  buildBatchRanges,
  mergeBatchedExtraction,
  singleDocumentExtraction,
  type BatchSnapshotRecord,
} from "@/lib/pipeline/batch-plan";
import { materialConflictFindings } from "@/lib/pipeline/validate";
import type { ExtractionResult } from "@/lib/pipeline/schema";

interface RangeLike {
  from: number;
  to: number;
}

function successRecord(
  range: RangeLike,
  overrides: { supplierName?: string; truncated?: boolean; note?: string } = {},
): BatchSnapshotRecord {
  const pages = [];
  for (let page = range.from; page <= range.to; page += 1) {
    pages.push({ page, text: `page ${page}`, images: 0, truncated: false, extracted: true });
  }
  const evidence = Object.fromEntries(pages.map((page) => [`field_${page.page}`, { page: page.page }]));
  return {
    key: batchRangeKey(range),
    from: range.from,
    to: range.to,
    ok: true,
    processedPages: pages.length,
    truncated: overrides.truncated,
    snapshot: {
      supplierName: overrides.supplierName ?? "Acme Supplies",
      invoiceNumber: "INV-100",
      invoiceDate: "2026-01-01",
      total: "100.00",
      lineItems: [
        {
          description: `Item ${range.from}`,
          quantity: "1",
          unitPrice: "100.00",
          lineTotal: "100.00",
        },
      ],
      capture: {
        pages,
        fullText: pages.map((page) => page.text).join("\n"),
        evidence,
        coverage: {
          pagesTotal: pages.length,
          pagesProcessed: pages.length,
          pagesFailed: 0,
          complete: true,
          note: overrides.note,
        },
      },
    } as Partial<ExtractionResult>,
  };
}

function failedRecord(range: RangeLike, code = "invalid_input"): BatchSnapshotRecord {
  return {
    key: batchRangeKey(range),
    from: range.from,
    to: range.to,
    ok: false,
    processedPages: 0,
    code,
    message: `Could not extract ${batchRangeKey(range)}`,
  };
}

describe("batch planning", () => {
  it("splits pages into stable inclusive ranges", () => {
    expect(BATCH_PAGE_SIZE).toBe(3);
    expect(buildBatchRanges(8)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 8 },
    ]);
    expect(buildBatchRanges(3)).toEqual([{ from: 1, to: 3 }]);
    expect(buildBatchRanges(1)).toEqual([{ from: 1, to: 1 }]);
    expect(buildBatchRanges(0)).toEqual([]);
    expect(buildBatchRanges(5, 2)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
      { from: 5, to: 5 },
    ]);
    expect(batchRangeKey({ from: 4, to: 6 })).toBe("4-6");
  });
});

describe("deterministic batch merge", () => {
  it("merges out-of-order batch snapshots by original page number", () => {
    const merged = mergeBatchedExtraction({
      pageCount: 4,
      records: [successRecord({ from: 3, to: 4 }), successRecord({ from: 1, to: 2 })],
    });

    expect(merged.capture?.pages?.map((page) => page.page)).toEqual([1, 2, 3, 4]);
    expect(merged.capture?.pages?.map((page) => page.text)).toEqual([
      "page 1",
      "page 2",
      "page 3",
      "page 4",
    ]);
    expect(Object.keys(merged.capture?.evidence ?? {}).sort()).toEqual([
      "field_1",
      "field_2",
      "field_3",
      "field_4",
    ]);
    expect(merged.capture?.coverage).toMatchObject({
      pagesTotal: 4,
      pagesProcessed: 4,
      pagesFailed: 0,
      complete: true,
    });
    expect(merged.lineItems).toHaveLength(2);
  });

  it("preserves conflicts instead of silently choosing a later batch value", () => {
    const merged = mergeBatchedExtraction({
      pageCount: 2,
      records: [
        successRecord({ from: 1, to: 1 }, { supplierName: "Acme Supplies" }),
        successRecord({ from: 2, to: 2 }, { supplierName: "Other Vendor" }),
      ],
    });

    expect(merged.supplierName).toBe("Acme Supplies");
    const conflicts = merged.additional_fields?.conflicts as Array<Record<string, unknown>>;
    expect(conflicts.some((conflict) => conflict.field === "supplierName")).toBe(true);
    expect(materialConflictFindings(merged).map((finding) => finding.code)).toContain("FIELD_CONFLICT");
  });

  it("marks coverage incomplete when a batch fails", () => {
    const merged = mergeBatchedExtraction({
      pageCount: 8,
      records: [
        successRecord({ from: 1, to: 3 }),
        successRecord({ from: 4, to: 6 }),
        failedRecord({ from: 7, to: 8 }),
      ],
    });

    expect(merged.capture?.coverage).toMatchObject({
      pagesTotal: 8,
      pagesProcessed: 6,
      pagesFailed: 2,
      complete: false,
    });
    expect(String(merged.capture?.coverage?.note)).toContain("7-8");
    expect(merged.capture?.pages?.map((page) => page.page)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("marks coverage incomplete when a batch was truncated", () => {
    const merged = mergeBatchedExtraction({
      pageCount: 3,
      records: [successRecord({ from: 1, to: 3 }, { truncated: true })],
    });

    expect(merged.capture?.coverage?.complete).toBe(false);
    expect(String(merged.capture?.coverage?.note).toLowerCase()).toContain("truncated");
  });
});

describe("single-document grounding", () => {
  it("does not trust a model that claims complete coverage for omitted pages", () => {
    const snapshot: ExtractionResult = {
      supplierName: "Acme",
      total: "10.00",
      capture: {
        pages: [{ page: 1, text: "first page", extracted: true }],
        fullText: "first page",
        coverage: { pagesTotal: 1, pagesProcessed: 1, pagesFailed: 0, complete: true },
      },
    };

    const grounded = singleDocumentExtraction(snapshot, 3);
    expect(grounded.capture?.coverage?.complete).toBe(false);
    expect(grounded.capture?.coverage?.pagesTotal).toBe(3);
    expect(String(grounded.capture?.coverage?.note)).toContain("1 of 3");
  });
});
