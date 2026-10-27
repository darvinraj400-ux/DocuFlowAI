import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createSupabaseInvoiceJobStore, type InvoiceJobStore } from "@/lib/inngest/job-store";
import { createProcessInvoiceHandler, type JobResult } from "@/lib/inngest/job-handler";
import type { InvoiceProcessingRequestedData } from "@/lib/inngest/events";
import type { PageRange } from "@/lib/pipeline/batch-plan";
import type { ExtractionResult } from "@/lib/pipeline/schema";
import type {
  ExtractionOutcome,
  ExtractionProvider,
  PageRangedProvider,
} from "@/lib/providers/types";
import {
  FakeSupabaseAdmin,
  invoiceRow,
  lineItemsFor,
  seedInvoice,
} from "../helpers/fake-supabase";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([400, 600]);
  return doc.save();
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

function providerMeta() {
  return { provider: "fake", model: "fake-model", demo: false, durationMs: 1 };
}

function extractionFor(
  pages: number[],
  pageCount = pages.length,
  lineItemPages = pages,
): ExtractionResult {
  return {
    supplierName: "Acme Supplies",
    invoiceNumber: "INV-100",
    invoiceDate: "2026-01-01",
    currencyCode: "USD",
    total: "100.00",
    lineItems: lineItemPages.map((page) => ({
      description: `Item ${page}`,
      quantity: "1",
      unitPrice: "100.00",
      lineTotal: "100.00",
    })),
    capture: {
      pages: pages.map((page) => ({
        page,
        text: `page ${page}`,
        images: 0,
        truncated: false,
        extracted: true,
      })),
      fullText: pages.map((page) => `page ${page}`).join("\n"),
      coverage: {
        pagesTotal: pageCount,
        pagesProcessed: pageCount,
        pagesFailed: 0,
        complete: true,
      },
    },
  };
}

type RangeBehavior = (range: PageRange, attempt: number) => "ok" | "transient" | "permanent";

function createRangedProvider(behavior: RangeBehavior = () => "ok") {
  const calls: string[] = [];
  const attempts = new Map<string, number>();

  const provider: PageRangedProvider = {
    id: "fake-ranged",
    demo: false,
    extract: async (): Promise<ExtractionOutcome> => ({
      ok: false,
      error: { code: "invalid_input", message: "document mode is not used for ranged tests" },
    }),
    extractRange: async (_input, range): Promise<ExtractionOutcome> => {
      const key = `${range.from}-${range.to}`;
      calls.push(key);
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const mode = behavior(range, attempt);
      if (mode === "transient") {
        return { ok: false, error: { code: "timeout", message: "upstream timeout" } };
      }
      if (mode === "permanent") {
        return { ok: false, error: { code: "invalid_input", message: `unreadable pages ${key}` } };
      }
      const pages: number[] = [];
      for (let page = range.from; page <= range.to; page += 1) pages.push(page);
      return {
        ok: true,
        data: extractionFor(pages, pages.length, [range.from]),
        meta: providerMeta(),
      };
    },
  };

  return { provider, calls, attempts };
}

function createDocumentProvider() {
  const calls: number[] = [];
  const provider: ExtractionProvider = {
    id: "fake-document",
    demo: false,
    extract: async (input): Promise<ExtractionOutcome> => {
      const pageCount = input.pageCount ?? 1;
      calls.push(pageCount);
      const pages: number[] = [];
      for (let page = 1; page <= pageCount; page += 1) pages.push(page);
      return { ok: true, data: extractionFor(pages, pageCount), meta: providerMeta() };
    },
  };
  return { provider, calls };
}

interface JobRunOutcome {
  result: JobResult | null;
  error: unknown;
  cache: Map<string, unknown>;
}

async function runJob(args: {
  store: InvoiceJobStore;
  createProvider: () => ExtractionProvider;
  event: InvoiceProcessingRequestedData;
  cache?: Map<string, unknown>;
}): Promise<JobRunOutcome> {
  const handler = createProcessInvoiceHandler(() => ({
    store: args.store,
    createProvider: args.createProvider,
    maxPdfPages: 10,
  }));
  const cache = args.cache ?? new Map<string, unknown>();
  const step = {
    run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      if (cache.has(id)) return cache.get(id) as T;
      const value = await fn();
      cache.set(id, value);
      return value;
    },
  };

  try {
    const result = await handler({ event: { data: args.event }, step });
    return { result, error: null, cache };
  } catch (error) {
    return { result: null, error, cache };
  }
}

function setup() {
  const admin = new FakeSupabaseAdmin();
  const store = createSupabaseInvoiceJobStore(admin.asClient());
  return { admin, store };
}

function metaOf(admin: FakeSupabaseAdmin, id: string): Record<string, unknown> {
  return invoiceRow(admin, id).extraction_meta as Record<string, unknown>;
}

describe("durable invoice job", () => {
  it("rejects a malformed event without touching any invoice", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(2) });
    const { provider, calls } = createRangedProvider();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: {
        invoiceId: "not-a-uuid",
        ownerId: seed.ownerId,
        jobId: randomUUID(),
      } as unknown as InvoiceProcessingRequestedData,
    });

    expect(run.result).toBeNull();
    expect(run.error).toBeInstanceOf(Error);
    expect((run.error as Error).name).toBe("NonRetriableError");
    expect(calls).toEqual([]);
    expect(invoiceRow(admin, seed.id).status).toBe("uploaded");
  });

  it("does not claim an invoice owned by a different user", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(2) });
    const { provider, calls } = createRangedProvider();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: randomUUID(), jobId: randomUUID() },
    });

    expect(run.result).toEqual({
      status: "skipped",
      invoiceId: seed.id,
      reason: "not_found",
    });
    expect(calls).toEqual([]);
    expect(invoiceRow(admin, seed.id).status).toBe("uploaded");
  });

  it("processes an 8-page PDF in three durable page batches", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider, calls } = createRangedProvider();
    const jobId = randomUUID();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId },
    });

    expect(run.error).toBeNull();
    expect(run.result).toEqual({ status: "completed", invoiceId: seed.id });
    expect(calls).toEqual(["1-3", "4-6", "7-8"]);
    expect([...run.cache.keys()]).toEqual([
      "claim-invoice",
      "prepare-document",
      "extract-pages-1-3",
      "extract-pages-4-6",
      "extract-pages-7-8",
      "finalize-invoice",
    ]);

    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("needs_review");
    expect(row.file_sha256).toMatch(/^[a-f0-9]{64}$/);

    const extracted = row.extracted_data as {
      capture: { pages: Array<{ page: number }>; coverage: Record<string, unknown> };
    };
    expect(extracted.capture.pages.map((page) => page.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(extracted.capture.coverage).toMatchObject({
      pagesTotal: 8,
      pagesProcessed: 8,
      pagesFailed: 0,
      complete: true,
    });

    const meta = metaOf(admin, seed.id);
    expect(meta).toMatchObject({
      provider: "fake-ranged",
      model: "batched",
      batched: true,
      batches: 3,
      jobId,
      _jobId: jobId,
    });
    const batches = meta._batches as {
      fileSha256: string;
      pageCount: number;
      totalRanges: number;
      ranges: Record<string, Record<string, unknown>>;
    };
    expect(batches.fileSha256).toBe(row.file_sha256);
    expect(batches.pageCount).toBe(8);
    expect(batches.totalRanges).toBe(3);
    expect(Object.keys(batches.ranges).sort()).toEqual(["1-3", "4-6", "7-8"]);
    for (const key of Object.keys(batches.ranges)) {
      expect(batches.ranges[key]).toMatchObject({ key, ok: true });
      // Large snapshots are cleared after the final merge.
      expect(batches.ranges[key].snapshot).toBeUndefined();
    }

    expect(lineItemsFor(admin, seed.id)).toHaveLength(3);
    const events = admin.rows("invoice_events").map((event) => event.event_type);
    expect(events).toContain("processing_succeeded");
    expect(events).toContain("needs_review");
  });

  it("retries only the transient batch and reuses completed steps", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider, calls } = createRangedProvider((range, attempt) =>
      range.from === 4 && attempt === 1 ? "transient" : "ok",
    );
    const jobId = randomUUID();
    const event = { invoiceId: seed.id, ownerId: seed.ownerId, jobId };

    const first = await runJob({ store, createProvider: () => provider, event });
    expect(first.result).toBeNull();
    expect(first.error).toBeInstanceOf(Error);
    expect(calls).toEqual(["1-3", "4-6"]);

    const afterFailure = metaOf(admin, seed.id);
    const firstBatches = afterFailure._batches as { ranges: Record<string, Record<string, unknown>> };
    expect(firstBatches.ranges["1-3"]).toMatchObject({ ok: true, processedPages: 3 });
    expect(firstBatches.ranges["4-6"]).toBeUndefined();
    expect(invoiceRow(admin, seed.id).status).toBe("processing");

    const second = await runJob({
      store,
      createProvider: () => provider,
      event,
      cache: first.cache,
    });

    expect(second.error).toBeNull();
    expect(second.result).toEqual({ status: "completed", invoiceId: seed.id });
    // 1-3 came from the memoized step; only the failed batch ran again.
    expect(calls).toEqual(["1-3", "4-6", "4-6", "7-8"]);

    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("needs_review");
    const extracted = row.extracted_data as {
      capture: { pages: Array<{ page: number }> };
    };
    expect(extracted.capture.pages.map((page) => page.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("resumes a new job from persisted checkpoints without losing completed batches", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider, calls } = createRangedProvider((range, attempt) =>
      range.from === 4 && attempt === 1 ? "transient" : "ok",
    );
    const firstJob = randomUUID();

    const first = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: firstJob },
    });
    expect(first.result).toBeNull();
    expect(calls).toEqual(["1-3", "4-6"]);

    // Worker crash path: the failure handler marks the job failed, then the
    // user retries with a brand new job id.
    const marked = await store.markJobFailed({
      invoiceId: seed.id,
      ownerId: seed.ownerId,
      jobId: firstJob,
      errorInfo: { code: "JOB_FAILED", message: "worker crashed" },
    });
    expect(marked).toBe(true);
    expect(invoiceRow(admin, seed.id).status).toBe("failed");

    const resumed = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(resumed.error).toBeNull();
    expect(resumed.result).toEqual({ status: "completed", invoiceId: seed.id });
    // Batch 1-3 was reused from the persisted checkpoint, not re-extracted.
    expect(calls).toEqual(["1-3", "4-6", "4-6", "7-8"]);
    expect(invoiceRow(admin, seed.id).status).toBe("needs_review");
  });

  it("keeps partial results reviewable when one batch fails permanently", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider } = createRangedProvider((range) =>
      range.from === 7 ? "permanent" : "ok",
    );

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(run.result).toEqual({ status: "completed", invoiceId: seed.id });
    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("needs_review");

    const extracted = row.extracted_data as {
      capture: {
        pages: Array<{ page: number }>;
        coverage: { pagesTotal: number; pagesProcessed: number; pagesFailed: number; complete: boolean; note?: string };
      };
    };
    expect(extracted.capture.pages.map((page) => page.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(extracted.capture.coverage).toMatchObject({
      pagesTotal: 8,
      pagesProcessed: 6,
      pagesFailed: 2,
      complete: false,
    });
    expect(String(extracted.capture.coverage.note)).toContain("7-8");

    const findings = row.validation_findings as Array<{ code: string }>;
    expect(findings.map((finding) => finding.code)).toContain("PARTIAL_EXTRACTION");

    const meta = metaOf(admin, seed.id);
    const ranges = (meta._batches as { ranges: Record<string, Record<string, unknown>> }).ranges;
    expect(ranges["7-8"]).toMatchObject({ ok: false, code: "invalid_input" });
    expect(ranges["7-8"].message).toContain("unreadable pages 7-8");
  });

  it("marks the invoice failed when every batch fails permanently", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider, calls } = createRangedProvider(() => "permanent");
    const jobId = randomUUID();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId },
    });

    expect(run.result).toEqual({
      status: "failed",
      invoiceId: seed.id,
      code: "invalid_input",
    });
    expect(calls).toEqual(["1-3", "4-6", "7-8"]);

    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("failed");
    expect(row.extracted_data).toBeNull();
    expect(lineItemsFor(admin, seed.id)).toHaveLength(0);
    expect(row.error_info).toMatchObject({
      code: "invalid_input",
      jobId,
      failedRanges: ["1-3", "4-6", "7-8"],
    });
    expect(admin.rows("invoice_events").map((event) => event.event_type)).toContain(
      "processing_failed",
    );
  });

  it("fails cleanly when the stored document is missing", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(2) });
    admin.storageFiles.clear();
    const { provider, calls } = createRangedProvider();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(run.result).toEqual({ status: "failed", invoiceId: seed.id, code: "FILE_MISSING" });
    expect(calls).toEqual([]);
    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("failed");
    expect(row.error_info).toMatchObject({ code: "FILE_MISSING" });
  });

  it("persists provider configuration errors as terminal failures", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(2) });

    const run = await runJob({
      store,
      createProvider: () => {
        throw new Error("AI_PROVIDER=gemini requires GEMINI_API_KEY to be set (server-only).");
      },
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(run.result).toEqual({
      status: "failed",
      invoiceId: seed.id,
      code: "PROVIDER_NOT_CONFIGURED",
    });
    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("failed");
    expect(row.error_info).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("prevents a superseded job from finalizing or overwriting newer state", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(2) });
    const { provider } = createRangedProvider();
    const jobA = randomUUID();

    const claim = await store.claimJob({
      invoiceId: seed.id,
      ownerId: seed.ownerId,
      jobId: jobA,
    });
    expect(claim.claimed).toBe(true);
    if (!claim.claimed) return;

    const prepared = await store.prepareDocument({
      invoice: claim.invoice,
      jobId: jobA,
      maxPdfPages: 10,
      provider,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.batched).toBe(false);

    const checkpointWritten = await store.writeCheckpoint({
      invoiceId: seed.id,
      ownerId: seed.ownerId,
      jobId: jobA,
      fileSha256: prepared.fileHash,
      checkpoint: {
        key: "document",
        ok: true,
        processedPages: 2,
        snapshot: extractionFor([1, 2]),
        at: new Date().toISOString(),
      },
    });
    expect(checkpointWritten).toBe(true);

    // A newer job takes over the same invoice while job A is still running.
    const jobB = randomUUID();
    const row = invoiceRow(admin, seed.id);
    row.extraction_meta = {
      ...(row.extraction_meta as Record<string, unknown>),
      _jobId: jobB,
    };
    row.updated_at = new Date().toISOString();

    const finalized = await store.finalizeJob({
      invoice: claim.invoice,
      jobId: jobA,
      expectedKeys: ["document"],
      prepared: {
        fileHash: prepared.fileHash,
        pageCount: prepared.pageCount,
        batched: prepared.batched,
        providerId: prepared.providerId,
        providerDemo: prepared.providerDemo,
      },
    });
    expect(finalized).toEqual({ outcome: "skipped", reason: "fence_lost" });

    const failed = await store.markJobFailed({
      invoiceId: seed.id,
      ownerId: seed.ownerId,
      jobId: jobA,
      errorInfo: { code: "JOB_FAILED", message: "stale worker" },
    });
    expect(failed).toBe(false);

    const lateWrite = await store.writeCheckpoint({
      invoiceId: seed.id,
      ownerId: seed.ownerId,
      jobId: jobA,
      fileSha256: prepared.fileHash,
      checkpoint: { key: "1-3", ok: true, processedPages: 3, at: new Date().toISOString() },
    });
    expect(lateWrite).toBe(false);

    const after = invoiceRow(admin, seed.id);
    expect(after.status).toBe("processing");
    expect((after.extraction_meta as Record<string, unknown>)._jobId).toBe(jobB);
  });

  it("finalizes exactly once for repeated finalize calls of the same job", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider } = createRangedProvider();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });
    expect(run.result).toEqual({ status: "completed", invoiceId: seed.id });

    const meta = metaOf(admin, seed.id);
    const batches = meta._batches as { fileSha256: string; pageCount: number };
    const eventsBefore = admin.rows("invoice_events").length;

    const again = await store.finalizeJob({
      invoice: {
        id: seed.id,
        ownerId: seed.ownerId,
        status: "needs_review",
        storagePath: seed.storagePath,
        originalFilename: "invoice.pdf",
        mimeType: "application/pdf",
        updatedAt: new Date().toISOString(),
        extractionMeta: meta,
      },
      jobId: meta._jobId as string,
      expectedKeys: ["1-3", "4-6", "7-8"],
      prepared: {
        fileHash: batches.fileSha256,
        pageCount: batches.pageCount,
        batched: true,
        providerId: "fake-ranged",
        providerDemo: false,
      },
    });

    expect(again).toEqual({ outcome: "saved" });
    expect(invoiceRow(admin, seed.id).status).toBe("needs_review");
    expect(lineItemsFor(admin, seed.id)).toHaveLength(3);
    expect(admin.rows("invoice_events").length).toBe(eventsBefore);
  });

  it("skips a duplicate event for an invoice that is already processed", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider, calls } = createRangedProvider();

    const first = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });
    expect(first.result).toEqual({ status: "completed", invoiceId: seed.id });
    expect(calls).toEqual(["1-3", "4-6", "7-8"]);

    const duplicate = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(duplicate.result).toEqual({
      status: "skipped",
      invoiceId: seed.id,
      reason: "ineligible",
    });
    expect(calls).toEqual(["1-3", "4-6", "7-8"]);
    expect(lineItemsFor(admin, seed.id)).toHaveLength(3);
    expect(invoiceRow(admin, seed.id).status).toBe("needs_review");
  });

  it("allows only one concurrent claim and can reclaim a stale processing claim", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(2) });
    const jobA = randomUUID();
    const jobB = randomUUID();

    const first = await store.claimJob({ invoiceId: seed.id, ownerId: seed.ownerId, jobId: jobA });
    expect(first.claimed).toBe(true);

    const second = await store.claimJob({ invoiceId: seed.id, ownerId: seed.ownerId, jobId: jobB });
    expect(second).toMatchObject({ claimed: false, reason: "busy", status: "processing" });
    expect((invoiceRow(admin, seed.id).extraction_meta as Record<string, unknown>)._jobId).toBe(
      jobA,
    );

    const foreign = await store.claimJob({
      invoiceId: seed.id,
      ownerId: randomUUID(),
      jobId: randomUUID(),
    });
    expect(foreign).toEqual({ claimed: false, reason: "not_found" });

    invoiceRow(admin, seed.id).updated_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stale = await store.claimJob({ invoiceId: seed.id, ownerId: seed.ownerId, jobId: jobB });
    expect(stale.claimed).toBe(true);
    expect((invoiceRow(admin, seed.id).extraction_meta as Record<string, unknown>)._jobId).toBe(
      jobB,
    );
  });

  it("extracts a PNG in a single document step", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, {
      bytes: PNG_BYTES,
      mimeType: "image/png",
      filename: "scan.png",
    });
    const { provider, calls } = createDocumentProvider();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(run.result).toEqual({ status: "completed", invoiceId: seed.id });
    expect(calls).toEqual([1]);
    expect([...run.cache.keys()]).toContain("extract-document");
    expect([...run.cache.keys()].some((key) => key.startsWith("extract-pages-"))).toBe(false);

    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("needs_review");
    expect(metaOf(admin, seed.id)).toMatchObject({ batched: false, batches: 1 });
    expect(
      (row.extracted_data as { capture: { coverage: { complete: boolean } } }).capture.coverage
        .complete,
    ).toBe(true);
  });

  it("keeps a multi-page PDF in one document step when the provider cannot range", async () => {
    const { admin, store } = setup();
    const seed = seedInvoice(admin, { bytes: await makePdf(8) });
    const { provider, calls } = createDocumentProvider();

    const run = await runJob({
      store,
      createProvider: () => provider,
      event: { invoiceId: seed.id, ownerId: seed.ownerId, jobId: randomUUID() },
    });

    expect(run.result).toEqual({ status: "completed", invoiceId: seed.id });
    expect(calls).toEqual([8]);
    expect([...run.cache.keys()]).toContain("extract-document");

    const row = invoiceRow(admin, seed.id);
    expect(row.status).toBe("needs_review");
    expect(metaOf(admin, seed.id)).toMatchObject({ batched: false, batches: 1 });
    const coverage = (
      row.extracted_data as {
        capture: { coverage: { pagesTotal: number; pagesProcessed: number; complete: boolean } };
      }
    ).capture.coverage;
    expect(coverage).toMatchObject({ pagesTotal: 8, pagesProcessed: 8, complete: true });
  });
});
