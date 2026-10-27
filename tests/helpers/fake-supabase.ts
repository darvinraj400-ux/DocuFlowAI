import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

type Filter =
  | { type: "eq" | "neq" | "lt"; column: string; value: unknown }
  | { type: "in"; column: string; values: unknown[] }
  | { type: "contains"; column: string; value: unknown };

type Mode = "select" | "update" | "insert" | "delete";

interface QueryResult {
  data: unknown;
  error: unknown;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Postgres `@>` subset semantics, enough for JSONB containment filters. */
function jsonContains(target: unknown, subset: unknown): boolean {
  if (Array.isArray(subset)) {
    return Array.isArray(target) && subset.every((item) => target.some((entry) => jsonContains(entry, item)));
  }
  if (subset !== null && typeof subset === "object") {
    if (target === null || typeof target !== "object" || Array.isArray(target)) return false;
    return Object.entries(subset as Row).every(([key, value]) =>
      jsonContains((target as Row)[key], value),
    );
  }
  return deepEqual(target, subset);
}

class FakeQuery implements PromiseLike<QueryResult> {
  private mode: Mode | null = null;
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private maxRows: number | null = null;

  constructor(
    private readonly admin: FakeSupabaseAdmin,
    private readonly table: string,
  ) {}

  select(): this {
    if (this.mode === null) this.mode = "select";
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ type: "neq", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ type: "in", column, values });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ type: "lt", column, value });
    return this;
  }

  contains(column: string, value: unknown): this {
    this.filters.push({ type: "contains", column, value });
    return this;
  }

  limit(count: number): this {
    this.maxRows = Math.max(0, Math.floor(count));
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
    const result = this.execute();
    const rows = Array.isArray(result) ? (result as Row[]) : [];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result: QueryResult = this.mode === "delete"
      ? { data: null, error: null }
      : { data: this.execute(), error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      switch (filter.type) {
        case "eq":
          return deepEqual(value, filter.value);
        case "neq":
          return !deepEqual(value, filter.value);
        case "in":
          return filter.values.some((candidate) => deepEqual(value, candidate));
        case "lt":
          return String(value) < String(filter.value);
        case "contains":
          return jsonContains(value, filter.value);
      }
    });
  }

  private execute(): Row[] {
    const rows = this.admin.rows(this.table);
    const matched = rows.filter((row) => this.matches(row));

    if (this.mode === "update") {
      const patch = this.payload as Row;
      for (const row of matched) {
        Object.assign(row, patch);
        row.updated_at = new Date().toISOString();
      }
      return matched.map((row) => ({ ...row }));
    }

    if (this.mode === "insert") {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload as Row]).map(
        (row) => ({ ...row }),
      );
      rows.push(...inserted);
      return inserted.map((row) => ({ ...row }));
    }

    if (this.mode === "delete") {
      for (const row of matched) {
        const index = rows.indexOf(row);
        if (index >= 0) rows.splice(index, 1);
      }
      return [];
    }

    return (this.maxRows == null ? matched : matched.slice(0, this.maxRows)).map((row) => ({
      ...row,
    }));
  }
}

/**
 * Minimal in-memory stand-in for the Supabase service-role client used by the
 * invoice job store: invoices, line items, events, and the private bucket.
 * It intentionally implements only the query surface the store uses.
 */
export class FakeSupabaseAdmin {
  readonly tables: Record<string, Row[]> = {
    invoices: [],
    invoice_line_items: [],
    invoice_events: [],
  };

  readonly storageFiles = new Map<string, Uint8Array>();

  readonly storage = {
    from: (bucket: string) => ({
      list: async (directory: string, options?: { search?: string }) => {
        const prefix = `${bucket}/${directory}/`;
        const names = [...this.storageFiles.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length));
        const search = options?.search;
        const matches = search ? names.filter((name) => name.startsWith(search)) : names;
        return { data: matches.map((name) => ({ name })), error: null };
      },
      download: async (path: string) => {
        const bytes = this.storageFiles.get(`${bucket}/${path}`);
        if (!bytes) return { data: null, error: new Error("Object not found") };
        const copy = new Uint8Array(bytes);
        return {
          data: {
            arrayBuffer: async () =>
              copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
          },
          error: null,
        };
      },
    }),
  };

  rows(table: string): Row[] {
    const rows = this.tables[table];
    if (!rows) throw new Error(`unexpected table ${table}`);
    return rows;
  }

  from(table: string): FakeQuery {
    this.rows(table);
    return new FakeQuery(this, table);
  }

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

export const INVOICE_BUCKET = "invoices";

export interface SeededInvoice {
  id: string;
  ownerId: string;
  storagePath: string;
  row: Row;
}

export function seedInvoice(
  admin: FakeSupabaseAdmin,
  input: {
    bytes: Uint8Array;
    mimeType?: string;
    filename?: string;
    status?: string;
    ownerId?: string;
    id?: string;
    extractionMeta?: Record<string, unknown> | null;
    fileSha256?: string | null;
    extractedData?: Record<string, unknown> | null;
    reviewedData?: Record<string, unknown> | null;
    reviewedAt?: string | null;
  },
): SeededInvoice {
  const ownerId = input.ownerId ?? randomUUID();
  const id = input.id ?? randomUUID();
  const mimeType = input.mimeType ?? "application/pdf";
  const filename = input.filename ?? (mimeType === "application/pdf" ? "invoice.pdf" : "invoice.png");
  const storagePath = `${ownerId}/${id}/original`;

  const row: Row = {
    id,
    user_id: ownerId,
    status: input.status ?? "uploaded",
    storage_path: storagePath,
    original_filename: filename,
    mime_type: mimeType,
    file_size_bytes: input.bytes.byteLength,
    file_sha256: input.fileSha256 ?? null,
    extracted_data: input.extractedData ?? null,
    reviewed_data: input.reviewedData ?? null,
    reviewed_at: input.reviewedAt ?? null,
    validation_findings: [],
    duplicate_flags: null,
    error_info: null,
    extraction_meta: input.extractionMeta ?? {},
    updated_at: new Date().toISOString(),
  };

  admin.rows("invoices").push(row);
  admin.storageFiles.set(`${INVOICE_BUCKET}/${storagePath}`, new Uint8Array(input.bytes));

  return { id, ownerId, storagePath, row };
}

export function invoiceRow(admin: FakeSupabaseAdmin, id: string): Row {
  const row = admin.rows("invoices").find((candidate) => candidate.id === id);
  if (!row) throw new Error(`invoice ${id} not found`);
  return row;
}

export function lineItemsFor(admin: FakeSupabaseAdmin, invoiceId: string): Row[] {
  return admin.rows("invoice_line_items").filter((row) => row.invoice_id === invoiceId);
}
