import { describe, expect, it } from "vitest";
import {
  accuracyOf,
  formatAccuracy,
  readComparableValue,
  valuesMatch,
} from "@/lib/accuracy/values";

describe("accuracy value comparison", () => {
  it("compares text case-insensitively with collapsed whitespace", () => {
    expect(valuesMatch("  Acme   Supplies Ltd ", "acme supplies ltd", "text")).toBe(true);
    expect(valuesMatch("Acme Supplies", "Acme Supply", "text")).toBe(false);
  });

  it("compares money as exact decimals", () => {
    expect(valuesMatch("10.0", "10.00", "money")).toBe(true);
    expect(valuesMatch("-5.250", "-5.25", "money")).toBe(true);
    expect(valuesMatch("10.01", "10.00", "money")).toBe(false);
  });

  it("falls back to text comparison when money is not decimal", () => {
    expect(valuesMatch("N/A", "n/a", "money")).toBe(true);
    expect(valuesMatch("1,000.00", "1000.00", "money")).toBe(false);
  });

  it("compares currencies case-insensitively but dates exactly", () => {
    expect(valuesMatch("gbp", "GBP", "currency")).toBe(true);
    expect(valuesMatch("2026-05-14", "2026-05-14", "date")).toBe(true);
    expect(valuesMatch("2026-5-14", "2026-05-14", "date")).toBe(false);
  });

  it("reads comparable scalars and rejects empty/non-scalar values", () => {
    expect(readComparableValue("  value ")).toBe("value");
    expect(readComparableValue("   ")).toBeNull();
    expect(readComparableValue(42)).toBe("42");
    expect(readComparableValue(Number.NaN)).toBeNull();
    expect(readComparableValue(null)).toBeNull();
    expect(readComparableValue(undefined)).toBeNull();
    expect(readComparableValue({ value: "x" })).toBeNull();
    expect(readComparableValue(["x"])).toBeNull();
  });

  it("returns null accuracy when nothing was compared", () => {
    expect(accuracyOf(0, 0)).toBeNull();
    expect(accuracyOf(2, 3)).toBeCloseTo(2 / 3);
  });

  it("formats accuracy as a one-decimal percentage or an em dash", () => {
    expect(formatAccuracy(null)).toBe("—");
    expect(formatAccuracy(1)).toBe("100.0%");
    expect(formatAccuracy(0)).toBe("0.0%");
    expect(formatAccuracy(2 / 3)).toBe("66.7%");
  });
});
