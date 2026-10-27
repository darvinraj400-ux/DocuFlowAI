import { LINE_ITEM_KEYS, type LineItem } from "@/lib/pipeline/schema";

/**
 * Re-attaches unrecognized (passthrough) fields to the reviewer's edited rows.
 *
 * Association uses the `sourceIndex` captured when the form was rendered, so
 * removing a row does not shift another row's extras onto it. The values copied
 * come exclusively from the server-side line items (`source`), never from the
 * submitted form, so a client cannot inject or overwrite preserved data.
 */
export function preserveUnknownLineItemFields(
  source: readonly LineItem[],
  edited: readonly LineItem[],
  sources: readonly (number | null)[],
): LineItem[] {
  return edited.map((line, index) => {
    const sourceIndex = sources[index] ?? null;
    const original =
      sourceIndex != null && sourceIndex >= 0 && sourceIndex < source.length
        ? source[sourceIndex]
        : undefined;
    if (!original) return line;

    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(original)) {
      if (LINE_ITEM_KEYS.has(key)) continue;
      extras[key] = value;
    }

    const submitted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(line)) {
      if (LINE_ITEM_KEYS.has(key)) submitted[key] = value;
    }
    return { ...extras, ...submitted } as LineItem;
  });
}
