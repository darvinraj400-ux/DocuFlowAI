import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * LIVE Supabase integration tests (opt-in).
 *
 * These require a dedicated TEST Supabase project and disposable users. They
 * are skipped unless explicitly enabled:
 *
 *   RUN_LIVE_INTEGRATION_TESTS=true
 *   SUPABASE_URL=...
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY)=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run: `pnpm test -- tests/integration/rls.test.ts`
 * Do NOT run against a production project.
 */

const live =
  process.env.RUN_LIVE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

function adminClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe.skipIf(!live)("live Supabase integration", () => {
  let admin: ReturnType<typeof adminClient>;
  let userA: { id: string; token: string } | undefined;
  let userB: { id: string; token: string } | undefined;
  const createdInvoiceIds: string[] = [];

  async function createUser(tag: string) {
    const email = `dfa-live-${Date.now()}-${tag}@example.com`;
    const password = "T3st-Passw0rd!";
    const { data: u, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !u.user) throw new Error(`createUser failed: ${error?.message}`);
    const { data: session, error: signInError } = await admin.auth.signInWithPassword({ email, password });
    if (signInError || !session.session) throw new Error("sign in failed");
    return { id: u.user.id, token: session.session.access_token };
  }

  beforeAll(async () => {
    admin = adminClient();
    userA = await createUser("A");
    userB = await createUser("B");
  });

  afterAll(async () => {
    // Best-effort cleanup of disposable data only.
    for (const id of createdInvoiceIds) {
      await admin.from("invoices").delete().eq("id", id);
    }
    if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => undefined);
    if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => undefined);
  });

  async function insertInvoice(ownerId: string, overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("invoices")
      .insert({
        user_id: ownerId,
        original_filename: "invoice.pdf",
        storage_path: `${ownerId}/abc/original.pdf`,
        mime_type: "application/pdf",
        file_size_bytes: 1000,
        file_sha256: "hash-" + Math.random().toString(36).slice(2),
        status: "uploaded",
        ...overrides,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert invoice failed: ${error?.message}`);
    if (data.id) createdInvoiceIds.push(data.id);
    return data.id as string;
  }

  it("validates the expected schema exists", async () => {
    const { data, error } = await admin.from("invoices").select("id").limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("persists extraction and validation results", async () => {
    const id = await insertInvoice(userA!.id);
    const findings = [{ code: "MISSING_TOTAL", severity: "error", message: "total missing", field: "total" }];
    const { error } = await admin
      .from("invoices")
      .update({ status: "needs_review", extracted_data: { supplierName: "Acme", total: "10.00" }, validation_findings: findings })
      .eq("id", id);
    expect(error).toBeNull();
    const { data } = await admin.from("invoices").select("status,extracted_data,validation_findings").eq("id", id).single();
    expect(data).toBeTruthy();
    expect(data!.status).toBe("needs_review");
    expect(data!.extracted_data.supplierName).toBe("Acme");
    expect(data!.validation_findings).toHaveLength(1);
  });

  it("denies cross-user reads", async () => {
    const id = await insertInvoice(userA!.id);
    const { data } = await userClient(userB!.token).from("invoices").select("id").eq("id", id);
    expect(data).toEqual([]);
  });

  it("denies cross-user updates", async () => {
    const id = await insertInvoice(userA!.id);
    const { data, error } = await userClient(userB!.token).from("invoices").update({ status: "approved" }).eq("id", id).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("allows owner reads", async () => {
    const id = await insertInvoice(userA!.id);
    const { data } = await userClient(userA!.token).from("invoices").select("id").eq("id", id);
    expect(data).toHaveLength(1);
  });

  it("direct-upload to storage is owner-scoped", async () => {
    const path = `${userA!.id}/${Date.now()}/original.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { error: upErr } = await userClient(userA!.token).storage.from("invoices").upload(path, bytes, { contentType: "image/png" });
    expect(upErr).toBeNull();

    const { error: readErr } = await userClient(userA!.token).storage.from("invoices").download(path);
    expect(readErr).toBeNull();

    const { error: crossErr } = await userClient(userB!.token).storage.from("invoices").download(path);
    expect(crossErr).not.toBeNull();
  });

  it("atomic processing claim is exclusive", async () => {
    const id = await insertInvoice(userA!.id);
    const claimOnce = async () => {
      const { data } = await admin
        .from("invoices")
        .update({ status: "processing" })
        .eq("id", id)
        .eq("user_id", userA!.id)
        .in("status", ["uploaded", "failed"])
        .select("id")
        .maybeSingle();
      return Boolean(data);
    };
    expect(await claimOnce()).toBe(true);
    expect(await claimOnce()).toBe(false);
  });

  it("line-item writes are idempotent on retry", async () => {
    const id = await insertInvoice(userA!.id);
    const rows = [{ invoice_id: id, description: "S", quantity: "1", line_total: "10.00" }];
    const insert = () => admin.from("invoice_line_items").insert(rows);
    await insert();
    await insert();
    const { count } = await admin.from("invoice_line_items").select("id", { head: true, count: "exact" }).eq("invoice_id", id);
    expect(count).toBe(1);
  });

  it("records approval and rejection audit events", async () => {
    const id = await insertInvoice(userA!.id, { status: "needs_review" });
    await admin.from("invoice_events").insert({ invoice_id: id, actor: userA!.id, event_type: "approved" });
    await admin.from("invoice_events").insert({ invoice_id: id, actor: userA!.id, event_type: "rejected", metadata: { rejectionNote: "dup" } });
    const { count } = await admin.from("invoice_events").select("id", { head: true, count: "exact" }).eq("invoice_id", id);
    expect(count).toBe(2);
  });
});
