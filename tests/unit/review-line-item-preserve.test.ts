import { describe, expect, it } from "vitest";
import { preserveUnknownLineItemFields } from "@/lib/review/line-items";
import type { LineItem } from "@/lib/pipeline/schema";

function line(overrides: Record<string, unknown>): LineItem {
  return {
    description: null,
    productCode: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    discountRate: null,
    discountAmount: null,
    taxRate: null,
    taxAmount: null,
    lineTotal: null,
    ...overrides,
  } as LineItem;
}

describe("preserveUnknownLineItemFields", () => {
  it("copies unknown fields from the associated source row", () => {
    const result = preserveUnknownLineItemFields(
      [line({ description: "Widget", batchCode: "A", attributes: { color: "red" } })],
      [line({ description: "Widget edited" })],
      [0],
    );

    expect(result[0]).toMatchObject({
      description: "Widget edited",
      batchCode: "A",
      attributes: { color: "red" },
    });
  });

  it("lets edited known fields win over the source values", () => {
    const result = preserveUnknownLineItemFields(
      [line({ description: "Before", lineTotal: "1.00", batchCode: "A" })],
      [line({ description: "After", lineTotal: "2.00" })],
      [0],
    );

    expect(result[0]).toMatchObject({ description: "After", lineTotal: "2.00", batchCode: "A" });
  });

  it("does not copy extras for new or invalid row associations", () => {
    const result = preserveUnknownLineItemFields(
      [line({ description: "Source", batchCode: "A" })],
      [line({ description: "New" }), line({ description: "Out of range" })],
      [null, 5],
    );

    expect(result[0]).not.toHaveProperty("batchCode");
    expect(result[1]).not.toHaveProperty("batchCode");
  });

  it("never adopts unknown fields submitted with the edited row", () => {
    const result = preserveUnknownLineItemFields(
      [line({ description: "Source", batchCode: "SERVER" })],
      [line({ description: "Edited", batchCode: "CLIENT", smuggled: "yes" })],
      [0],
    );

    expect(result[0]).toMatchObject({ description: "Edited", batchCode: "SERVER" });
    expect(result[0]).not.toHaveProperty("smuggled");
  });

  it("associates by source index, not by position in the edited array", () => {
    const result = preserveUnknownLineItemFields(
      [line({ description: "First", batchCode: "A" }), line({ description: "Second", batchCode: "B" })],
      [line({ description: "Second edited" })],
      [1],
    );

    expect(result[0]).toMatchObject({ description: "Second edited", batchCode: "B" });
  });
});
