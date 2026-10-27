import { z } from "zod";

/**
 * Universal, format-agnostic extraction schema.
 *
 * Design:
 * - Every field is OPTIONAL: an invoice may legitimately lack a buyer, order
 *   number, tax, due date, or line items. Missing fields normalize to `null`
 *   (or `[]` for collections), never invented values.
 * - Legacy canonical fields (`supplierName`, `invoiceNumber`, `invoiceDate`,
 *   `dueDate`, `currencyCode`, `subtotal`, `taxTotal`, `total`,
 *   `paymentTerms`, `lineItems`) are preserved for the UI, duplicate
 *   detection, and stored data compatibility.
 * - A normalization layer (`normalizeExtractionInput`) maps provider/model
 *   aliases (e.g. `vendor`, `customer`, `invoice_number`, `amount_due`) onto
 *   these canonical keys BEFORE validation. Unrecognized top-level fields are
 *   preserved in `additional_fields`, and the raw input is retained under
 *   `additional_fields.raw_input` for review/troubleshooting.
 * - Validation still checks TYPES and structure. It does not require any
 *   field to be present.
 */

/** Non-empty decimal string, e.g. "1234.56". Optional sign allowed so negative
 * credit adjustments can be captured and later flagged by validation. */
const moneyString = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "Money must be a decimal string (e.g. \"1234.56\").")
  .nullish();

const nullableString = z.string().trim().nullish();

/** Address may be a flat string or a structured object with street/city/etc. */
const addressSchema = z
  .union([
    nullableString,
    z
      .object({
        street: nullableString,
        city: nullableString,
        state: nullableString,
        zip: nullableString,
        postalCode: nullableString,
        country: nullableString,
      })
      .passthrough(),
  ])
  .nullish();

/**
 * Flexible contact/party entity. `.passthrough()` keeps unfamiliar sub-fields
 * on the entity object instead of silently dropping them.
 */
const partySchema = z
  .object({
    name: nullableString,
    taxId: nullableString,
    address: addressSchema,
    email: nullableString,
    phone: nullableString,
    website: nullableString,
  })
  .passthrough();

const lineItemSchema = z
  .object({
    description: nullableString,
    productCode: nullableString,
    quantity: moneyString,
    unit: nullableString,
    unitPrice: moneyString,
    discountRate: moneyString,
    discountAmount: moneyString,
    taxRate: moneyString,
    taxAmount: moneyString,
    lineTotal: moneyString,
  })
  .passthrough();

const amountEntrySchema = z
  .object({
    description: nullableString,
    amount: moneyString,
    rate: moneyString,
  })
  .passthrough();

const taxComponentSchema = z
  .object({
    name: nullableString,
    rate: moneyString,
    amount: moneyString,
    base: moneyString,
  })
  .passthrough();

const paymentDetailsSchema = z
  .object({
    method: nullableString,
    instructions: nullableString,
    bankName: nullableString,
    accountNumber: nullableString,
    routingNumber: nullableString,
    iban: nullableString,
    swift: nullableString,
    transactionRef: nullableString,
  })
  .passthrough();

const servicePeriodSchema = z
  .object({
    start: nullableString,
    end: nullableString,
  })
  .passthrough();

const capturePageSchema = z
  .object({
    page: z.number().int().positive(),
    text: nullableString,
    images: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
    extracted: z.boolean().optional(),
    note: nullableString,
  })
  .passthrough();

function toPositivePageNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    if (Number.isInteger(n) && n > 0 && String(n) === value.trim()) return n;
  }
  return null;
}

/**
 * Normalizes capture page entries before Zod validation:
 * - accepts `page_number` / `pageNumber` aliases,
 * - coerces numeric strings,
 * - moves entries without a resolvable one-based page number into
 *   `unassignedPages`, so the provider can reconcile them with trusted page
 *   numbers instead of failing the whole extraction with an obscure error.
 */
function sanitizeCapturePages(capture: Record<string, unknown>): void {
  if (!Array.isArray(capture.pages)) return;
  const pages: Record<string, unknown>[] = [];
  const unassigned: Record<string, unknown>[] = [];
  for (const entry of capture.pages) {
    if (!isPlainObject(entry)) continue;
    const normalizedEntry: Record<string, unknown> = { ...entry };
    const direct = toPositivePageNumber(normalizedEntry.page);
    const alias = direct ?? toPositivePageNumber(normalizedEntry.page_number) ?? toPositivePageNumber(normalizedEntry.pageNumber);
    if (alias != null) {
      normalizedEntry.page = alias;
      pages.push(normalizedEntry);
    } else {
      delete normalizedEntry.page;
      unassigned.push(normalizedEntry);
    }
  }
  capture.pages = pages;
  if (unassigned.length > 0) {
    capture.unassignedPages = unassigned;
  }
}

const captureCoverageSchema = z
  .object({
    pagesTotal: z.number().int().nonnegative().optional(),
    pagesProcessed: z.number().int().nonnegative().optional(),
    pagesFailed: z.number().int().nonnegative().optional(),
    complete: z.boolean().optional(),
    note: nullableString,
  })
  .passthrough();

/**
 * Loss-minimizing document capture: everything readable the model saw or
 * classified, with per-page provenance and coverage. Stored inside
 * `extracted_data` (jsonb) — no database migration required.
 */
const documentCaptureSchema = z
  .object({
    pages: z.array(capturePageSchema).optional(),
    fullText: nullableString,
    sections: z.record(z.string(), z.unknown()).optional(),
    coverage: captureCoverageSchema.optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const currencyComponentSchema = z
  .object({
    code: z.string().trim(),
    note: nullableString,
  })
  .passthrough();

export const extractionSchema = z
  .object({
    // --- legacy canonical keys (UI + duplicate detection) ---
    supplierName: nullableString,
    supplierTaxId: nullableString,
    invoiceNumber: nullableString,
    invoiceDate: nullableString,
    dueDate: nullableString,
    currencyCode: nullableString,
    subtotal: moneyString,
    taxTotal: moneyString,
    total: moneyString,
    paymentTerms: nullableString,

    // --- universal, optional keys ---
    documentType: nullableString,
    issueDate: nullableString,
    orderNumber: nullableString,
    referenceNumbers: z.array(z.string().trim()).optional(),
    seller: partySchema.nullish(),
    buyer: partySchema.nullish(),
    buyerName: nullableString,
    buyerTaxId: nullableString,
    servicePeriod: servicePeriodSchema.nullish(),
    otherDates: z.array(z.string().trim()).optional(),
    currencies: z.array(currencyComponentSchema).optional(),
    amountPaid: moneyString,
    balanceDue: moneyString,
    amountDiscounted: moneyString,
    shippingCost: moneyString,
    fees: z.array(amountEntrySchema).optional(),
    discounts: z.array(amountEntrySchema).optional(),
    taxes: z.array(taxComponentSchema).optional(),
    paymentDetails: paymentDetailsSchema.nullish(),
    lineItems: z.array(lineItemSchema).optional(),
    additional_fields: z.record(z.string(), z.unknown()).optional(),
    capture: documentCaptureSchema.optional(),
  })
  .strict();

export type ExtractionResult = z.infer<typeof extractionSchema>;
export type LineItem = z.infer<typeof lineItemSchema>;

export type ExtractionParseResult =
  | { ok: true; value: ExtractionResult }
  | { ok: false; error: string };

/** All literal keys the canonical model understands (used by normalization). */
export const CANONICAL_KEYS = new Set(Object.keys(extractionSchema.shape));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns a trimmed string or null for valid string/null input, otherwise the
 * raw value so Zod's type validation can reject genuinely invalid data.
 */
function asNullableString(value: unknown): string | null | unknown {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  return value;
}

/** Money/quantity strings: strings are kept, finite numbers are stringified. */
function asMoneyString(value: unknown): string | null | unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? null : t;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return value;
}

function asNullableArray(value: unknown): unknown[] | null | undefined {
  if (Array.isArray(value)) return value;
  return value == null ? null : undefined;
}

const PARTY_KEY_ALIASES: Record<string, string> = {
  name: "name",
  company_name: "name",
  company: "name",
  vendor_name: "name",
  seller_name: "name",
  supplier_name: "name",
  buyer_name: "name",
  customer_name: "name",
  tax_id: "taxId",
  vat_id: "taxId",
  vat_number: "taxId",
  vat: "taxId",
  taxid: "taxId",
  address: "address",
  billing_address: "address",
  email: "email",
  phone: "phone",
  telephone: "phone",
  contact: "phone",
  website: "website",
  url: "website",
};

function normalizeParty(value: unknown): Record<string, unknown> | null | undefined {
  if (!isPlainObject(value)) {
    if (typeof value === "string") return { name: value };
    return value == null ? null : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const mapped = PARTY_KEY_ALIASES[key.toLowerCase()];
    if (mapped) {
      if (out[mapped] == null) out[mapped] = asNullableString(val) ?? null;
    } else if (key === "id") {
      out.taxId = out.taxId ?? asNullableString(val) ?? null;
    } else {
      // preserve unknown sub-fields
      out[key] = val;
    }
  }
  return out;
}

const LINE_ITEM_KEY_ALIASES: Record<string, string> = {
  description: "description",
  name: "description",
  item: "description",
  product: "description",
  product_name: "description",
  productCode: "productCode",
  product_code: "productCode",
  sku: "productCode",
  quantity: "quantity",
  qty: "quantity",
  qty_num: "quantity",
  unit: "unit",
  uom: "unit",
  measure: "unit",
  unitPrice: "unitPrice",
  unit_price: "unitPrice",
  unitprice: "unitPrice",
  price: "unitPrice",
  rate: "unitPrice",
  taxRate: "taxRate",
  tax_rate: "taxRate",
  vat_rate: "taxRate",
  discountRate: "discountRate",
  discount_rate: "discountRate",
  discountAmount: "discountAmount",
  discount_amount: "discountAmount",
  discount: "discountAmount",
  taxAmount: "taxAmount",
  tax_amount: "taxAmount",
  tax: "taxAmount",
  lineTotal: "lineTotal",
  line_total: "lineTotal",
  linetotal: "lineTotal",
  total: "lineTotal",
  amount: "lineTotal",
};

const AMOUNT_ENTRY_ALIASES: Record<string, string> = {
  name: "description",
  description: "description",
  label: "description",
  type: "name",
  amount: "amount",
  value: "amount",
  total: "amount",
  rate: "rate",
  percent: "rate",
  percentage: "rate",
  discount: "rate",
};

function normalizeAmountEntry(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(value)) return { amount: asMoneyString(value) ?? null };
  for (const [key, val] of Object.entries(value)) {
    const mapped = AMOUNT_ENTRY_ALIASES[key.toLowerCase()];
    if (mapped) {
      if (out[mapped] == null) {
        out[mapped] = mapped === "description" || mapped === "name"
          ? asNullableString(val) ?? null
          : asMoneyString(val) ?? null;
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

const PAYMENT_DETAILS_ALIASES: Record<string, string> = {
  method: "method",
  payment_method: "method",
  instructions: "instructions",
  note: "instructions",
  bank_name: "bankName",
  bank: "bankName",
  account_number: "accountNumber",
  account_no: "accountNumber",
  routing_number: "routingNumber",
  sort_code: "routingNumber",
  iban: "iban",
  bic: "swift",
  swift: "swift",
  swift_code: "swift",
  transaction_ref: "transactionRef",
  transaction_reference: "transactionRef",
  reference: "transactionRef",
};

const TAX_COMPONENT_ALIASES: Record<string, string> = {
  name: "name",
  description: "name",
  tax_name: "name",
  vat_name: "name",
  rate: "rate",
  percent: "rate",
  percentage: "rate",
  vat_rate: "rate",
  tax_rate: "rate",
  amount: "amount",
  value: "amount",
  total: "amount",
  tax_amount: "amount",
  base: "base",
  base_amount: "base",
  taxable_amount: "base",
};

function normalizeTaxComponent(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(value)) return { amount: asMoneyString(value) ?? null };
  for (const [key, val] of Object.entries(value)) {
    const mapped = TAX_COMPONENT_ALIASES[key.toLowerCase()];
    if (mapped) {
      if (out[mapped] == null) {
        out[mapped] = mapped === "name"
          ? asNullableString(val) ?? null
          : asMoneyString(val) ?? null;
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

function normalizePaymentDetails(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(value)) return { raw: value };
  for (const [key, val] of Object.entries(value)) {
    const mapped = PAYMENT_DETAILS_ALIASES[key.toLowerCase()];
    if (mapped) {
      if (out[mapped] == null) out[mapped] = asNullableString(val) ?? null;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function normalizeLineItem(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(value)) return out;
  for (const [key, val] of Object.entries(value)) {
    const mapped = LINE_ITEM_KEY_ALIASES[key.toLowerCase()];
    if (mapped) {
      if (out[mapped] == null) {
        out[mapped] =
          mapped === "description" || mapped === "unit" || mapped === "productCode"
            ? asNullableString(val) ?? null
            : asMoneyString(val) ?? null;
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

const TOP_LEVEL_ALIASES: Record<string, string> = {
  // seller/vendor
  seller: "seller",
  vendor: "seller",
  supplier: "seller",
  seller_name: "supplierName",
  vendor_name: "supplierName",
  supplier_name: "supplierName",
  supplier_tax_id: "supplierTaxId",
  vendor_tax_id: "supplierTaxId",
  vat_number: "supplierTaxId",
  // buyer/customer
  buyer: "buyer",
  customer: "buyer",
  buyer_name: "buyerName",
  customer_name: "buyerName",
  buyer_tax_id: "buyerTaxId",
  customer_tax_id: "buyerTaxId",
  // numbers/references
  invoice_number: "invoiceNumber",
  invoice_no: "invoiceNumber",
  invoice_id: "invoiceNumber",
  invoiceid: "invoiceNumber",
  invoice: "invoiceNumber",
  order_number: "orderNumber",
  order_no: "orderNumber",
  po_number: "orderNumber",
  purchase_order: "orderNumber",
  purchase_order_number: "orderNumber",
  reference: "orderNumber",
  reference_number: "orderNumber",
  reference_numbers: "referenceNumbers",
  references: "referenceNumbers",
  document_type: "documentType",
  doc_type: "documentType",
  type: "documentType",
  // dates — evidence-aware: a generic "date" is not assumed to be the
  // invoice issue date; service/order/shipping dates stay in otherDates and
  // only explicit invoice/issue labels map to the canonical invoice date.
  invoice_date: "invoiceDate",
  issue_date: "issueDate",
  date_issued: "issueDate",
  issued_date: "issueDate",
  due_date: "dueDate",
  payment_due_date: "dueDate",
  service_date: "otherDates",
  service_dates: "otherDates",
  order_date: "otherDates",
  order_dates: "otherDates",
  shipping_date: "otherDates",
  delivery_date: "otherDates",
  period_start: "otherDates",
  period_end: "otherDates",
  service_period: "servicePeriod",
  billing_period: "servicePeriod",
  period: "servicePeriod",
  other_dates: "otherDates",
  // currency & money
  currency: "currencyCode",
  currency_code: "currencyCode",
  currencycode: "currencyCode",
  currencies: "currencies",
  subtotal: "subtotal",
  sub_total: "subtotal",
  "sub-total": "subtotal",
  net_total: "subtotal",
  tax_total: "taxTotal",
  total_tax: "taxTotal",
  total_taxes: "taxTotal",
  total: "total",
  grand_total: "total",
  total_amount: "total",
  amount: "total",
  amount_paid: "amountPaid",
  paid_amount: "amountPaid",
  total_paid: "amountPaid",
  amount_due: "balanceDue",
  balance_due: "balanceDue",
  amount_payable: "balanceDue",
  outstanding: "balanceDue",
  balance: "balanceDue",
  amount_discounted: "amountDiscounted",
  total_discount: "amountDiscounted",
  shipping: "shippingCost",
  shipping_cost: "shippingCost",
  freight: "shippingCost",
  // taxes, fees, discounts, payments
  taxes: "taxes",
  tax_breakdown: "taxes",
  tax: "taxes",
  fees: "fees",
  fee: "fees",
  charges: "fees",
  surcharges: "fees",
  discounts: "discounts",
  discount: "discounts",
  payment_terms: "paymentTerms",
  terms: "paymentTerms",
  paymentterms: "paymentTerms",
  payment_details: "paymentDetails",
  bank_details: "paymentDetails",
  payment_info: "paymentDetails",
  payment_method: "paymentDetails",
  paymentmethod: "paymentDetails",
  capture: "capture",
  document_capture: "capture",
  raw_capture: "capture",
  // line items
  line_items: "lineItems",
  items: "lineItems",
  lineitems: "lineItems",
  lines: "lineItems",
  products: "lineItems",
};

function normalizeTopLevelKey(key: string): string {
  return TOP_LEVEL_ALIASES[key.toLowerCase()] ?? key;
}

/**
 * Maps a raw provider/model output onto the canonical schema shape.
 * - Aliases are mapped to canonical keys (e.g. `vendor` -> `seller`,
 *   `amount_due` -> `balanceDue`).
 * - Unknown top-level fields are preserved in `additional_fields`.
 * - The raw input is retained as `additional_fields.raw_input`.
 * - Numeric money values are stringified; real type errors are left for Zod.
 */
const RESERVED_ENVELOPE_KEYS = new Set(["capture", "classification", "document_capture"]);

/**
 * Resolves supported provider response envelopes:
 * - flat JSON (canonical or aliases): used as-is
 * - `{ capture: {...}, classification: {...} }`: business fields live inside
 *   `classification`; `capture` stays metadata
 * - `{ invoice: {...}, ... }` legacy wrapper: business fields inside `invoice`
 */
export function resolveEnvelope(input: Record<string, unknown>): {
  business: Record<string, unknown>;
  classification: Record<string, unknown> | null;
} {
  if (isPlainObject(input.classification)) {
    // Wrapped envelope: business semantics live in `classification`; root-level
    // fields (canonical, aliases, metadata like capture/additional_fields) are
    // kept and take precedence over the envelope on conflicts.
    const classification = input.classification as Record<string, unknown>;
    const business: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key !== "classification") business[key] = value;
    }
    return { business, classification };
  }
  if (isPlainObject(input.invoice) && Object.keys(input).every((k) => k === "invoice")) {
    return { business: input.invoice as Record<string, unknown>, classification: null };
  }
  // Flat response: everything (including capture/evidence) is business scope.
  return { business: input, classification: null };
}

const IDENTITY_TARGET_GROUPS: Array<Array<string>> = [
  ["supplierName", "seller"],
  ["buyerName", "buyer"],
];

function identityName(target: string, value: unknown): unknown {
  if (target === "supplierName" || target === "buyerName") return value;
  if (isPlainObject(value)) {
    const name = value.name;
    if (typeof name === "string") return name;
  } else if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function detectFieldConflicts(
  business: Record<string, unknown>,
  classification: Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  const conflicts: Array<Record<string, unknown>> = [];
  if (!classification) return conflicts;
  const targetOf = (key: string) => {
    if (RESERVED_ENVELOPE_KEYS.has(key)) return null;
    return normalizeTopLevelKey(key);
  };
  const sameIdentityGroup = (a: string, b: string) =>
    IDENTITY_TARGET_GROUPS.some((group) => group.includes(a) && group.includes(b));

  for (const [bKey, bValue] of Object.entries(business)) {
    const bTarget = targetOf(bKey);
    if (bTarget == null) continue;
    for (const [cKey, cValue] of Object.entries(classification)) {
      const cTarget = targetOf(cKey);
      if (cTarget == null) continue;

      let differs = false;
      let field = bTarget;
      let values: unknown[] = [bValue, cValue];

      if (cTarget === bTarget) {
        differs = JSON.stringify(cValue) !== JSON.stringify(bValue);
      } else if (sameIdentityGroup(bTarget, cTarget)) {
        const bName = identityName(bTarget, bValue);
        const cName = identityName(cTarget, cValue);
        if (bName !== undefined && cName !== undefined) {
          differs = JSON.stringify(cName) !== JSON.stringify(bName);
          field = bTarget === "seller" || cTarget === "seller" ? "supplierName" : "buyerName";
          values = [bName, cName];
        }
      }

      if (differs) {
        conflicts.push({
          field,
          values,
          sources: [`root:${bKey}`, `classification:${cKey}`],
        });
      }
    }
  }
  return conflicts;
}

function inferCurrencyFromContext(raw: Record<string, unknown>): { code: string; reason: string } | null {
  const text = JSON.stringify(raw).toLowerCase();
  const hasDollar = text.includes("$") || text.includes("usd");
  if (!hasDollar) return null;
  const usContext = /united states|usa|\bu\.?s\.?a?\b|north america/.test(text);
  if (!usContext) return null;
  return { code: "USD", reason: "dollar amounts + United States context present in source" };
}

export function normalizeExtractionInput(raw: unknown): Record<string, unknown> {
  const input = isPlainObject(raw) ? raw : { _raw: raw };
  const { business, classification } = resolveEnvelope(input);
  const conflicts = detectFieldConflicts(business, classification);

  // Deterministic precedence: root-level fields win over classification
  // envelope fields. Both are still iterated so unified aliases merge.
  const loopInput: Record<string, unknown> = classification ? { ...classification, ...business } : business;

  const canonical: Record<string, unknown> = {};
  const additional: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(loopInput)) {
    const normalizedKey = normalizeTopLevelKey(key);
    const target: string = normalizedKey;

    if (normalizedKey === "seller" || normalizedKey === "buyer") {
      // merge a string value or object party into the entity
      const party = normalizeParty(value);
      if (party != null) {
        const existing = isPlainObject(canonical[normalizedKey]) ? canonical[normalizedKey] as Record<string, unknown> : {};
        canonical[normalizedKey] = { ...existing, ...party };
        if (normalizedKey === "seller") {
          if (canonical.supplierName != null && party.name != null && String(canonical.supplierName) !== String(party.name)) {
            // ambiguous supplier evidence: keep both candidates for review
            const existingAlternatives = Array.isArray(additional.supplier_alternatives) ? additional.supplier_alternatives as string[] : [];
            additional.supplier_alternatives = Array.from(new Set([...existingAlternatives, String(canonical.supplierName), String(party.name)]));
            additional.supplier_ambiguous = true;
          }
          canonical.supplierName = canonical.supplierName ?? party.name ?? null;
          canonical.supplierTaxId = canonical.supplierTaxId ?? party.taxId ?? null;
        } else {
          canonical.buyerName = canonical.buyerName ?? party.name ?? null;
          canonical.buyerTaxId = canonical.buyerTaxId ?? party.taxId ?? null;
        }
      }
      continue;
    } else if (normalizedKey === "supplierName" || normalizedKey === "supplierTaxId") {
      canonical[normalizedKey] = asNullableString(value) ?? canonical[normalizedKey] ?? null;
      continue;
    } else if (normalizedKey === "buyerName" || normalizedKey === "buyerTaxId") {
      canonical[normalizedKey] = asNullableString(value) ?? canonical[normalizedKey] ?? null;
      continue;
    } else if (normalizedKey === "lineItems") {
      const items = asNullableArray(value);
      canonical.lineItems = items
        ? items.map((item) => normalizeLineItem(item))
        : [];
      continue;
    } else if (normalizedKey === "taxes") {
      const taxes = asNullableArray(value);
      if (taxes) {
        canonical.taxes = taxes.map((t) => normalizeTaxComponent(t));
      } else if (isPlainObject(value)) {
        canonical.taxes = [normalizeTaxComponent(value)];
      } else if (typeof value === "number" || typeof value === "string") {
        // a bare scalar tax: treat as taxTotal when total is not otherwise known
        canonical.taxTotal = canonical.taxTotal ?? asMoneyString(value) ?? null;
      }
      continue;
    } else if (normalizedKey === "fees" || normalizedKey === "discounts") {
      const entries = asNullableArray(value);
      canonical[normalizedKey] = entries ? entries.map((e) => normalizeAmountEntry(e)) : [];
      continue;
    } else if (normalizedKey === "currencies") {
      const entries = asNullableArray(value);
      canonical.currencies = entries
        ? entries.map((e) => (isPlainObject(e) ? e : { code: String(e) }))
        : [];
      if (canonical.currencyCode == null) {
        const first = canonical.currencies as Array<{ code?: unknown }>;
        if (first[0]?.code != null) canonical.currencyCode = asNullableString(first[0].code) ?? null;
      }
      continue;
    } else if (normalizedKey === "referenceNumbers" || normalizedKey === "otherDates") {
      const arr = asNullableArray(value);
      const list = arr ? arr : typeof value === "string" ? [value] : [];
      canonical[normalizedKey] = list.map((v) => (typeof v === "string" ? v.trim() : String(v)));
      continue;
    } else if (normalizedKey === "servicePeriod" || normalizedKey === "paymentDetails") {
      if (normalizedKey === "paymentDetails") {
        if (isPlainObject(value)) {
          canonical.paymentDetails = normalizePaymentDetails(value);
        } else if (typeof value === "string") {
          const existing = isPlainObject(canonical.paymentDetails) ? canonical.paymentDetails as Record<string, unknown> : {};
          canonical.paymentDetails = { ...existing, method: value.trim() };
          if (key === "payment_method" || key === "paymentmethod") {
            additional.payment_method = value;
          }
        } else {
          canonical.paymentDetails = value == null ? null : { raw: value };
        }
      } else {
        canonical.servicePeriod = isPlainObject(value) ? value : value == null ? null : { raw: value };
      }
      continue;
    } else if (normalizedKey === "invoiceDate" || normalizedKey === "issueDate") {
      const d = asNullableString(value);
      if (d != null) {
        // keep legacy and universal date keys in sync
        canonical.invoiceDate = canonical.invoiceDate ?? d;
        canonical.issueDate = canonical.issueDate ?? d;
      }
      continue;
    } else if (normalizedKey === "dueDate") {
      canonical.dueDate = asNullableString(value) ?? canonical.dueDate ?? null;
      continue;
    } else if (normalizedKey === "currencyCode") {
      canonical.currencyCode = asNullableString(value) ?? canonical.currencyCode ?? null;
      continue;
    } else if (normalizedKey === "invoiceNumber" || normalizedKey === "orderNumber" || normalizedKey === "documentType" || normalizedKey === "paymentTerms") {
      canonical[normalizedKey] = asNullableString(value) ?? canonical[normalizedKey] ?? null;
      continue;
    } else if (
      normalizedKey === "subtotal" ||
      normalizedKey === "taxTotal" ||
      normalizedKey === "total" ||
      normalizedKey === "amountPaid" ||
      normalizedKey === "balanceDue" ||
      normalizedKey === "amountDiscounted" ||
      normalizedKey === "shippingCost"
    ) {
      const money = asMoneyString(value) ?? canonical[normalizedKey] ?? null;
      canonical[normalizedKey] = money;
      // amount_due / balance semantics: when the document clearly means the
      // total amount payable and no total is otherwise present, mirror it so
      // canonical total validation has something real — while preserving the
      // original source key.
      if (normalizedKey === "balanceDue" && canonical.total == null && money != null) {
        canonical.total = money;
        additional.amount_due = value;
      }
      continue;
    }

    if (CANONICAL_KEYS.has(target)) {
      canonical[target] = value;
    } else if (target === "additional_fields") {
      if (isPlainObject(value)) {
        Object.assign(additional, value);
      }
    } else {
      additional[key] = value;
    }
  }

  if (isPlainObject(canonical.capture)) {
    sanitizeCapturePages(canonical.capture as Record<string, unknown>);
  }

  if (conflicts.length > 0) {
    additional.conflicts = conflicts;
  }

  // Evidence-aware currency: only infer when the source itself carries an
  // unambiguous dollar + United States context. Never a blind default.
  const inferredCurrency = inferCurrencyFromContext({ ...input, ...loopInput });
  if (inferredCurrency && canonical.currencyCode == null) {
    canonical.currencyCode = inferredCurrency.code;
    additional._inferred_currency = {
      field: "currencyCode",
      value: inferredCurrency.code,
      source: inferredCurrency.reason,
      confidence: "medium",
    };
    const capture = isPlainObject(canonical.capture) ? (canonical.capture as Record<string, unknown>) : {};
    const inferences = Array.isArray(capture.inferences) ? capture.inferences as unknown[] : [];
    capture.inferences = [
      ...inferences,
      { field: "currencyCode", value: inferredCurrency.code, source: inferredCurrency.reason, confidence: "medium" },
    ];
    canonical.capture = capture;
  }

  canonical.additional_fields = { ...additional, raw_input: input };
  return canonical;
}

export function parseExtraction(data: unknown): ExtractionParseResult {
  if (!isPlainObject(data)) {
    return { ok: false, error: "Extraction data must be a JSON object." };
  }
  const normalized = normalizeExtractionInput(data);
  const result = extractionSchema.safeParse(normalized);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  // Normalize nullish -> null and collection defaults for consistent storage.
  // Spread the validated values so passthrough (unknown) sub-fields survive.
  const value = result.data;
  return {
    ok: true,
    value: {
      ...value,
      supplierName: value.supplierName ?? null,
      supplierTaxId: value.supplierTaxId ?? null,
      invoiceNumber: value.invoiceNumber ?? null,
      invoiceDate: value.invoiceDate ?? null,
      dueDate: value.dueDate ?? null,
      currencyCode: value.currencyCode ?? null,
      subtotal: value.subtotal ?? null,
      taxTotal: value.taxTotal ?? null,
      total: value.total ?? null,
      paymentTerms: value.paymentTerms ?? null,
      documentType: value.documentType ?? null,
      issueDate: value.issueDate ?? null,
      orderNumber: value.orderNumber ?? null,
      referenceNumbers: value.referenceNumbers ?? [],
      seller: value.seller ?? null,
      buyer: value.buyer ?? null,
      buyerName: value.buyerName ?? null,
      buyerTaxId: value.buyerTaxId ?? null,
      servicePeriod: value.servicePeriod ?? null,
      otherDates: value.otherDates ?? [],
      currencies: value.currencies ?? [],
      amountPaid: value.amountPaid ?? null,
      balanceDue: value.balanceDue ?? null,
      amountDiscounted: value.amountDiscounted ?? null,
      shippingCost: value.shippingCost ?? null,
      fees: value.fees ?? [],
      discounts: value.discounts ?? [],
      taxes: value.taxes ?? [],
      paymentDetails: value.paymentDetails ?? null,
      lineItems: (value.lineItems ?? []).map((line) => ({
        ...line,
        description: line.description ?? null,
        productCode: line.productCode ?? null,
        quantity: line.quantity ?? null,
        unit: line.unit ?? null,
        unitPrice: line.unitPrice ?? null,
        discountRate: line.discountRate ?? null,
        discountAmount: line.discountAmount ?? null,
        taxRate: line.taxRate ?? null,
        taxAmount: line.taxAmount ?? null,
        lineTotal: line.lineTotal ?? null,
      })),
      additional_fields: value.additional_fields ?? {},
      capture: value.capture ?? undefined,
    },
  };
}
