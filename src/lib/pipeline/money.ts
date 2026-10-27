import Decimal from "decimal.js";

/**
 * Exact decimal helpers built on decimal.js. Money is handled as decimal
 * strings end-to-end; floating-point arithmetic is never used for financial
 * comparison or validation.
 */

export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}

export function isNonNegative(value: string): boolean {
  return new Decimal(value).greaterThanOrEqualTo(0);
}

/** Rounding tolerance: at least 0.01 and 0.5% of the reference amount. */
export function toleranceFor(reference: string): Decimal {
  const ref = new Decimal(reference ?? "0").abs();
  const halfPercent = ref.mul("0.005");
  return halfPercent.greaterThan(new Decimal("0.01")) ? halfPercent : new Decimal("0.01");
}

/**
 * Returns true when |subtotal + tax - total| is within tolerance.
 * Returns null when not enough information is present to compute it.
 */
export function totalsAreConsistent(
  subtotal: string | null | undefined,
  tax: string | null | undefined,
  total: string | null | undefined,
): boolean | null {
  if (subtotal == null || total == null) return null;
  const st = new Decimal(subtotal);
  const tt = new Decimal(total);
  let computed = st;
  if (tax != null) computed = computed.plus(new Decimal(tax));
  const diff = computed.minus(tt).abs();
  return diff.lessThanOrEqualTo(toleranceFor(total));
}

/**
 * Returns true when quantity × unit price is within tolerance of the line
 * total. Returns null when insufficient info is present.
 */
export function lineTotalIsConsistent(
  quantity: string | null | undefined,
  unitPrice: string | null | undefined,
  lineTotal: string | null | undefined,
): boolean | null {
  if (quantity == null || unitPrice == null || lineTotal == null) return null;
  const computed = new Decimal(quantity).mul(new Decimal(unitPrice));
  const diff = computed.minus(new Decimal(lineTotal)).abs();
  return diff.lessThanOrEqualTo(toleranceFor(lineTotal));
}
