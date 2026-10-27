import Decimal from "decimal.js";

/**
 * Comparison primitives shared by the synthetic extraction evaluation and the
 * human-reviewed accuracy report.
 *
 * Text is compared case-insensitively with collapsed whitespace; money and
 * quantities are compared as exact decimals (so "10.0" and "10.00" match);
 * currencies are case-insensitive; dates must match exactly after trimming.
 */
export type ValueKind = "text" | "money" | "date" | "currency";

/** Reads a comparable scalar from stored/extracted JSON, or null when absent. */
export function readComparableValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Returns true when two non-empty comparable values are equivalent. */
export function valuesMatch(left: string, right: string, kind: ValueKind): boolean {
  if (kind === "money") {
    try {
      return new Decimal(left).eq(new Decimal(right));
    } catch {
      return normalizeText(left) === normalizeText(right);
    }
  }
  if (kind === "currency") return left.toUpperCase() === right.toUpperCase();
  if (kind === "text") return normalizeText(left) === normalizeText(right);
  return left === right;
}

/** Fraction in [0, 1], or null when there is nothing comparable. */
export function accuracyOf(matches: number, compared: number): number | null {
  return compared > 0 ? matches / compared : null;
}

/** Formats a fraction as a one-decimal percentage, or an em dash. */
export function formatAccuracy(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}
