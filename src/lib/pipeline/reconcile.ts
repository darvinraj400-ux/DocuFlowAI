import type { ExtractionResult } from "@/lib/pipeline/schema";

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function mergeUnique<T>(list: T[] | undefined, incoming: T[] | undefined, keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list ?? []) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  for (const item of incoming ?? []) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function lineItemKey(item: Record<string, unknown>): string {
  return fingerprint([item.description, item.quantity, item.unitPrice, item.lineTotal]);
}

/**
 * Merges batch extraction contributions into one document-level result:
 * - scalar fields: first non-null wins; materially different later values are
 *   preserved as conflicts, never silently chosen;
 * - line items/taxes/fees/discounts/currencies/references/dates: deduplicated
 *   concatenation;
 * - capture pages: merged by original page number;
 * - evidence/sections: deep-merged;
 * - additional_fields/raw_input: original preserved, missing keys filled.
 */
export function mergeBatchContributions(
  current: Partial<ExtractionResult>,
  incoming: Partial<ExtractionResult>,
): Partial<ExtractionResult> {
  const merged: Partial<ExtractionResult> = { ...current };

  const conflicts: Array<Record<string, unknown>> = Array.isArray(current.additional_fields?.conflicts)
    ? (current.additional_fields!.conflicts as Array<Record<string, unknown>>)
    : [];

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;

    if (key === "lineItems") {
      merged.lineItems = mergeUnique(current.lineItems as Record<string, unknown>[], value as Record<string, unknown>[], lineItemKey) as typeof merged.lineItems;
      continue;
    }
    if (key === "taxes" || key === "fees" || key === "discounts" || key === "currencies" || key === "referenceNumbers" || key === "otherDates") {
      const prior = (current as Record<string, unknown>)[key] as unknown[] | undefined;
      const next = value as unknown[];
      (merged as Record<string, unknown>)[key] = mergeUnique(prior, next, (item) =>
        typeof item === "object" && item !== null ? fingerprint(item) : fingerprint([item]),
      );
      continue;
    }
    if (key === "capture") {
      const priorCapture = current.capture as Record<string, unknown> | undefined;
      const nextCapture = value as Record<string, unknown>;
      const pages = new Map<number, Record<string, unknown>>();
      for (const page of (priorCapture?.pages as Array<Record<string, unknown>> | undefined) ?? []) {
        if (typeof page.page === "number") pages.set(page.page, page);
      }
      for (const page of (nextCapture.pages as Array<Record<string, unknown>> | undefined) ?? []) {
        if (typeof page.page === "number") pages.set(page.page, page);
        else pages.set(-(pages.size + 1), page);
      }
      const evidence = { ...(priorCapture?.evidence as Record<string, unknown> | undefined), ...(nextCapture.evidence as Record<string, unknown> | undefined) };
      const sections = { ...(priorCapture?.sections as Record<string, unknown> | undefined), ...(nextCapture.sections as Record<string, unknown> | undefined) };
      const coverage = {
        ...(priorCapture?.coverage as Record<string, unknown> | undefined),
        ...(nextCapture.coverage as Record<string, unknown> | undefined),
      };
      merged.capture = {
        ...priorCapture,
        ...nextCapture,
        pages: Array.from(pages.values()).sort((a, b) => (a.page as number) - (b.page as number)),
        evidence,
        sections,
        coverage,
      } as typeof merged.capture;
      continue;
    }
    if (key === "additional_fields") {
      const priorFields = current.additional_fields ?? {};
      const nextFields = value as Record<string, unknown>;
      merged.additional_fields = { ...priorFields };
      for (const [k, v] of Object.entries(nextFields)) {
        if (!(k in merged.additional_fields)) (merged.additional_fields as Record<string, unknown>)[k] = v;
      }
      if (conflicts.length > 0) (merged.additional_fields as Record<string, unknown>).conflicts = conflicts;
      continue;
    }

    const priorValue = (current as Record<string, unknown>)[key];
    if (priorValue === undefined || priorValue === null) {
      (merged as Record<string, unknown>)[key] = value;
      continue;
    }
    if (fingerprint(priorValue) !== fingerprint(value)) {
      conflicts.push({
        field: key,
        values: [priorValue, value],
        sources: ["accumulated", "incoming batch"],
      });
    }
  }

  if (conflicts.length > 0) {
    merged.additional_fields = { ...(merged.additional_fields ?? {}), conflicts };
  }
  return merged;
}
