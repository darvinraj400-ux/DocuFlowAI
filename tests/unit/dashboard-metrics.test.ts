import { describe, expect, it } from "vitest";
import { computeMetrics } from "@/lib/dashboard/metrics";

describe("dashboard metrics", () => {
  it("shows honest zeros for no invoices", () => {
    expect(computeMetrics([])).toEqual({
      total: 0,
      awaitingReview: 0,
      approved: 0,
      failed: 0,
    });
  });

  it("aggregates statuses correctly", () => {
    const metrics = computeMetrics([
      "uploaded",
      "processing",
      "needs_review",
      "needs_review",
      "approved",
      "failed",
    ]);
    expect(metrics.total).toBe(6);
    expect(metrics.awaitingReview).toBe(2);
    expect(metrics.approved).toBe(1);
    expect(metrics.failed).toBe(1);
  });
});
