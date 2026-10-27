import { describe, expect, it } from "vitest";
import { canTransition, INVOICE_STATUSES } from "@/types/invoice";

describe("invoice status transitions", () => {
  it("allows uploaded -> processing", () => {
    expect(canTransition("uploaded", "processing")).toBe(true);
  });

  it("allows processing -> needs_review", () => {
    expect(canTransition("processing", "needs_review")).toBe(true);
  });

  it("allows processing -> failed and failed -> processing (retry)", () => {
    expect(canTransition("processing", "failed")).toBe(true);
    expect(canTransition("failed", "processing")).toBe(true);
  });

  it("never auto-approves: needs human action", () => {
    expect(canTransition("processing", "approved")).toBe(false);
    expect(canTransition("uploaded", "approved")).toBe(false);
  });

  it("allows needs_review -> approved / rejected", () => {
    expect(canTransition("needs_review", "approved")).toBe(true);
    expect(canTransition("needs_review", "rejected")).toBe(true);
  });

  it("is terminal once approved or rejected", () => {
    expect(canTransition("approved", "needs_review")).toBe(false);
    expect(canTransition("rejected", "needs_review")).toBe(false);
  });

  it("exposes the full expected status set", () => {
    expect(INVOICE_STATUSES).toEqual([
      "uploaded",
      "processing",
      "needs_review",
      "approved",
      "rejected",
      "failed",
    ]);
  });
});
