import type { InvoiceStatus } from "@/types/invoice";

export interface InvoiceMetrics {
  total: number;
  awaitingReview: number;
  approved: number;
  failed: number;
}

/**
 * Aggregates invoice states into honest dashboard metrics.
 * Pure and unit-testable. `total` counts every invoice row for the user.
 */
export function computeMetrics(statuses: readonly InvoiceStatus[]): InvoiceMetrics {
  return {
    total: statuses.length,
    awaitingReview: statuses.filter((s) => s === "needs_review").length,
    approved: statuses.filter((s) => s === "approved").length,
    failed: statuses.filter((s) => s === "failed").length,
  };
}
