import { describe, expect, it } from "vitest";
import { totalsAreConsistent, lineTotalIsConsistent, toleranceFor } from "@/lib/pipeline/money";

describe("money arithmetic", () => {
  it("accepts matching totals", () => {
    expect(totalsAreConsistent("100.00", "20.00", "120.00")).toBe(true);
  });

  it("accepts small rounding differences", () => {
    expect(totalsAreConsistent("100.00", "20.00", "120.01")).toBe(true);
  });

  it("flags clear inconsistencies", () => {
    expect(totalsAreConsistent("100.00", "20.00", "300.00")).toBe(false);
  });

  it("returns null when insufficient information", () => {
    expect(totalsAreConsistent(null, "20.00", "120.00")).toBeNull();
    expect(totalsAreConsistent("100.00", "20.00", null)).toBeNull();
  });

  it("validates line totals", () => {
    expect(lineTotalIsConsistent("10", "10.00", "100.00")).toBe(true);
    expect(lineTotalIsConsistent("10", "10.00", "150.00")).toBe(false);
    expect(lineTotalIsConsistent(null, "10.00", "100.00")).toBeNull();
  });

  it("computes a sensible tolerance", () => {
    expect(toleranceFor("120.00").toString()).toBe("0.6");
    expect(toleranceFor("1.00").toString()).toBe("0.01");
  });
});
