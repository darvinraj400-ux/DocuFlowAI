# DocuFlow AI

DocuFlow AI is an AI invoice-processing and document-automation web app. A
signed-in user uploads a supplier invoice, the app extracts structured data with
AI (Gemini), validates it with deterministic business rules, detects duplicates,
and routes it to a human review queue. Nothing is auto-approved — a person makes
the final call.

## Architecture

```
Browser ──► Next.js 16 (App Router)
              │  ├─ /upload          (direct-to-Storage upload flow)
              │  ├─ /api/invoices/upload-intent
              │  ├─ /api/invoices/:id/process   (auth + ownership; enqueues work)
              │  ├─ /api/invoices/:id/status    (owner-scoped progress)
              │  ├─ /api/inngest                (Inngest serve handler)
              │  ├─ /invoices        (search, status filter, pagination)
              │  ├─ /invoices/:id    (progress / review UI)
              │  ├─ /reports         (read-only extraction-accuracy report)
              │  └─ /settings        (account + read-only processing config)
              │
              ├─ Inngest durable `process-invoice` function
              │    └─ one step per PDF page batch, DB checkpoints, fenced finalize
              ├─ Supabase Auth (SSR, PKCE)
              ├─ Supabase PostgreSQL + RLS
              ├─ Supabase Storage (private, owner-scoped signed URLs)
              └─ Extraction provider abstraction
                   ├─ Gemini (@google/genai, structured JSON)
                   ├─ Groq (groq-sdk)
                   └─ Mock (deterministic, demo mode)
```

The processing flow is durable: authenticate → verify ownership → enqueue a
minimal `invoice/processing.requested` event (`invoiceId`, `ownerId`, `jobId`)
→ return `202 queued` without changing the invoice status → the worker
independently re-checks ownership, atomically claims the invoice, downloads and
validates the private file, extracts each PDF page batch in its own
`step.run()`, persists per-batch checkpoints in `extraction_meta`, merges
deterministically, then performs a single fenced transition to `needs_review`
(never auto-approve). Failures are recorded as `failed` with a retry path.

## What works (Phases 1–4)

- Direct-to-Storage upload with server-validated upload-intent.
- Secure enqueue endpoint plus a durable Inngest worker (atomic claim, bounded
  retries, per-invoice and per-user concurrency limits).
- Per-batch checkpoints with resume, owner-scoped progress polling, and
  deterministic merge.
- Gemini extraction (structured output) with strict Zod validation + mock provider.
- Deterministic monetary validation (decimal.js) and duplicate detection.
- Invoice history, detail, and review UI (edit, save, approve, reject).
- Invoice search by number, supplier, or filename with validated status/page
  filters and deterministic pagination.
- Settings for the signed-in account (email, password change) plus a read-only
  view of processing configuration — no secrets are exposed.
- Line-item add/edit/remove in review, with decimal validation and preservation
  of extraction-only line fields; edits are stored as `reviewed_data`.
- Extraction-accuracy reporting at `/reports`, comparing approved invoices'
  immutable AI output with the human-approved snapshot. It reports per-field
  matches, corrections, missed/cleared values, line-item structure changes, and
  honest empty states without modifying any invoice data.
- A provider-agnostic evaluation harness over four synthetic invoices that
  reports field-level exact-match, missing/invented values, line-item and tax
  structure, and validation behavior. The mock baseline is deterministic and
  asserted offline; live Gemini runs are opt-in and recorded without accuracy
  assertions.
- Real dashboard metrics from the database (honest empty states).

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 + shadcn/ui ·
Supabase (Auth, PostgreSQL, Storage) · Zod · decimal.js · @google/genai ·
pdf-lib · Vitest · pnpm · Vercel.

## Prerequisites

- Node.js 20+ (Node 24 recommended), pnpm 9+
- A Supabase project, a Vercel account (for deployment)

## Environment variables

Copy `.env.example` → `.env.local`. Key variables:

| Variable | Purpose | Browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy fallback | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key | **No** |
| `AI_PROVIDER` | `gemini`, `groq`, or `mock` | No |
| `GEMINI_API_KEY` | Gemini API key | **No** |
| `GEMINI_MODEL` | Model (default `gemini-3.8-flash`) | No |
| `GROQ_API_KEY` | Groq API key (required when `AI_PROVIDER=groq`) | **No** |
| `GROQ_MODEL` | Groq model (default `qwen/qwen3.8-27b`, multimodal) | No |
| `MAX_PDF_PAGES` | PDF page limit (default 10) | No |
| `MAX_CONCURRENT_PROCESSING` | Per-user processing cap (default 3) | No |
| `INNGEST_DEV` | Force Inngest dev-server mode (`1`) or cloud mode (`0`) | No |
| `INNGEST_EVENT_KEY` | Inngest Cloud event key | **No** |
| `INNGEST_SIGNING_KEY` | Inngest Cloud signing key | **No** |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for emails/redirects | Yes |

Service-role, AI provider, and Inngest keys are never exposed via
`NEXT_PUBLIC_*`. In local development the Inngest Dev Server needs no keys.

## Setting up Supabase

1. Create a project at https://supabase.com (free tier fine).
2. Project Settings → API: copy URL + publishable/anon key + service-role key.
3. Apply migrations (`supabase/migrations`):

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

   Migrations create the `invoices`, `invoice_line_items`, `invoice_events`
   tables, RLS, the private `invoices` storage bucket with owner-scoped
   policies, and the duplicate-search indexes.
4. Authentication → URL Configuration: set Site URL and add redirect URLs
   (e.g. `http://localhost:3000/**` and your production URL).

## AI providers

Extraction runs through one of three providers selected by `AI_PROVIDER`:

- `gemini` (default) — multimodal `@google/genai` provider; supports text-based
  and scanned PDFs via inline image data. Requires `GEMINI_API_KEY`.
- `groq` — Groq-hosted model via `groq-sdk`; requires `GROQ_API_KEY`. Default
  model is `qwen/qwen3.8-27b`, Groq's multimodal model (text + up to 3 images
  per request), so both digitally generated PDFs and scanned/image-only PDFs can
  be extracted. Digitally generated PDFs are read via `pdf-parse` text
  extraction; scanned/image-only PDFs are handled by extracting the PDF's
  embedded page images (pure pdf.js path — no native rendering dependency) and
  sending up to 3 of them as image input. PDFs whose scans use unsupported
  compression (e.g. CCITT/JBIG2) or that contain no embedded images produce a
  clear, actionable error rather than silently skipping pages. If
  `GROQ_MODEL` is set to a text-only model (e.g. `openai/gpt-oss-20b`),
  scanned/image-only PDFs and image uploads are rejected with a clear error —
  switch back to a multimodal `GROQ_MODEL` or to `AI_PROVIDER=gemini` to
  process them.
- `mock` — deterministic demo provider, no key, no network, visibly labelled.

All providers return the same normalized invoice schema, validated with Zod
before persistence. Document content is treated as untrusted data; the prompt
explicitly forbids following instructions inside invoices, and no tools are
exposed to the model.

## Running locally

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm dev
```

Then open http://localhost:3000.

## Durable processing with Inngest

Processing runs in an Inngest function, so the app needs the Inngest Dev Server
running alongside Next.js in local development. No Inngest keys are required
locally.

**Terminal 1 — Inngest Dev Server (PowerShell):**

```powershell
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The Dev Server UI is at http://localhost:8288 and the app's serve endpoint is
http://localhost:3000/api/inngest.

**Terminal 2 — Next.js (PowerShell):**

```powershell
pnpm install   # first run only
pnpm dev
```

Notes:

- Set `AI_PROVIDER=mock` in `.env.local` for a fully offline end-to-end run.
- With `INNGEST_DEV` unset, dev mode is inferred whenever `NODE_ENV` is not
  `production`. Set `INNGEST_DEV=1` to force it, or `INNGEST_DEV=0` to force
  cloud mode.
- For Inngest Cloud, set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`
  server-side and register `https://<your-app>/api/inngest` in the Inngest
  dashboard. Never expose these keys to the browser.
- The process route returns `503` with code `ENQUEUE_FAILED` when the event is
  not accepted; the invoice stays retryable and is never reported as queued.

Verify the integration:

1. Open http://localhost:8288 — the app `docuflow-ai` and function
   `process-invoice` should be registered.
2. Upload a PDF or image and land on `/invoices/:id`; it shows **Queued**, then
   **Processing**, and only shows review fields after the server persists
   `needs_review`.
3. In the Dev Server, the run for `invoice/processing.requested` shows
   `claim-invoice`, `prepare-document`, one `extract-pages-<from>-<to>` step per
   batch, and `finalize-invoice`.

Batch and retry semantics:

- PDFs over 3 pages with a page-ranged provider split into 3-page batches; each
  batch is its own `step.run()` with a stable ID (`extract-pages-1-3`, …).
  Images and providers without range support use one `extract-document` step.
- Successful batches are checkpointed in `extraction_meta._batches`, keyed by
  the file's SHA-256, and reused by retries or by a later job on the same file.
- Transient provider failures (timeout, rate limit, outage) retry under the
  function's bounded retry policy; permanent validation failures are persisted
  and do not loop.
- The final merge is deterministic and preserves conflicts, page evidence, and
  coverage. A single fenced update transitions the invoice to `needs_review`;
  stale or superseded jobs cannot overwrite a newer result.

## Demo mode (mock provider)

Set `AI_PROVIDER=mock` to run the whole workflow with a deterministic provider
that needs no API key and no network. The UI visibly labels results as
"Simulated extraction". There is no silent fallback from Gemini to mock.

## Tests

```bash
pnpm test          # mocked suite — no paid API calls, no live credentials
pnpm evaluate      # extraction evaluation harness (mock baseline offline)
pnpm typecheck
pnpm lint
pnpm build
```

Test coverage includes: extraction schema parsing, missing fields, provider
error handling, PDF/PNG/JPEG validation, oversized/invalid files, PDF page
limits, decimal arithmetic/tolerance, duplicate file & supplier/number
detection, status transitions, concurrent claims, ownership checks, save /
approve / reject validation, dashboard metrics and empty states, accuracy value
normalization, extraction-accuracy report aggregation (missing reviewed
snapshots, structural line-item edits, report bounds), evaluation comparison
and reporting (matches, mismatches, missing/invented values, provider failures),
plus durable processing: event validation, enqueue success/failure,
owner-scoped status refresh and polling termination, per-batch retry/resume
from checkpoints, page-number preservation and coverage grounding,
exactly-once finalization, partial/terminal failures, and superseded-job
fencing. Inngest and AI providers are mocked; no live calls are needed.

Live RLS integration tests (`tests/integration/rls.test.ts`) are gated on real
Supabase test credentials and skipped otherwise.

## Testing live extraction & the full flow

1. Configure Supabase + `GEMINI_API_KEY` (or leave `AI_PROVIDER=mock`).
2. Start the app and register/sign in.
3. Go to `/upload` and upload a small PDF/JPEG/PNG (≤5 MB, ≤10 pages).
4. The file is validated client + server side, uploaded to private storage, and
   queued. With both servers running, the Inngest worker extracts it and the
   detail page refreshes when it lands in `/invoices/:id` as `needs_review`.
5. Review: inspect the original document, edit fields, save corrections, then
   approve or reject. Approvals are blocked while error-level validation issues
   remain, and the original extraction is preserved separately from reviewed
   data.

## Validation, duplicates, and review

- Validation produces findings with a stable code, severity (info/warning/error),
  message, and field. Money uses decimal strings and decimal.js (tolerance =
  max 0.01 and 0.5% of the reference).
- Duplicate detection compares server-computed SHA-256 hashes and normalized
  supplier + invoice-number keys. Duplicates are flagged — never deleted.
- Review stores edited values in `reviewed_data` without overwriting
  `extracted_data`. Approval sets `approved` only after re-validating and
  clearing error findings; rejection records the reviewer, time, and optional
  note. Both write audit events.

## Live verification & evaluation

All ordinary tests run offline with mocks. Live suites are **opt-in** and are
skipped unless the relevant flag and credentials are present:

- Supabase integration (`tests/integration/rls.test.ts`) — requires
  `RUN_LIVE_INTEGRATION_TESTS=true` plus `SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or anon), and
  `SUPABASE_SERVICE_ROLE_KEY`. Uses disposable users; never run against a
  production project.
- Gemini smoke/evaluation (`tests/integration/live-gemini.test.ts`,
  `tests/evaluation/extraction-accuracy.test.ts`) — requires
  `RUN_LIVE_GEMINI_TESTS=true` and `GEMINI_API_KEY`. The evaluation harness
  (`pnpm evaluate`) runs four synthetic invoices — a single-line GBP baseline,
  a multi-line EUR invoice, a sparse USD invoice, and an invoice with fractional
  quantities and a discount — and reports field-level exact-match, missing,
  invented, and mismatched values, line-item/tax structure, and validation
  behavior. The mock baseline is deterministic and asserted at 100%; live
  results are recorded for review and are never auto-asserted to an accuracy
  target. Set `EVALUATION_JSON=true` to also print the complete machine-readable
  run.

```bash
# Run everything offline (no paid calls):
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# Evaluation harness (deterministic mock baseline offline):
pnpm evaluate
EVALUATION_JSON=true pnpm evaluate

# Live Supabase integration (opt-in):
RUN_LIVE_INTEGRATION_TESTS=true pnpm test -- tests/integration/rls.test.ts

# Live Gemini smoke + evaluation (opt-in):
RUN_LIVE_GEMINI_TESTS=true GEMINI_API_KEY=... pnpm test -- tests/integration/live-gemini.test.ts tests/evaluation/extraction-accuracy.test.ts
```

### Extraction-accuracy report (`/reports`)

The authenticated, read-only report compares the immutable AI extraction
(`extracted_data`) of approved invoices with the human-approved snapshot
(`reviewed_data`). It shows overall, header, and line-item accuracy plus
per-field matches, corrections, missed and cleared values, line-item structure
changes, and the evaluated invoices.

- Only fields present in the reviewed snapshot are scored, so legacy or partial
  records never fabricate agreement or disagreement.
- Line-item fields are compared positionally only when both versions have the
  same row count. Invoices with added or removed rows are excluded from
  line-item accuracy and reported separately.
- Text matches ignore case and whitespace, money and quantities compare as exact
  decimals, currencies ignore case, and dates must match exactly.
- The report reads at most the 500 most recent approved invoices for the
  signed-in user. It never modifies invoices, review decisions, audit events, or
  extraction data, and both RLS and an explicit `user_id` filter constrain it.

### Model compatibility

- **Gemini**: uses `@google/genai` with structured JSON output
  (`responseMimeType: application/json` + `responseSchema`) and the configurable
  `GEMINI_MODEL` (default `gemini-3.8-flash`). The model must support
  `generateContent` with inline-data (PDF/image) input.
- **Groq**: uses `groq-sdk` with `response_format: json_schema` (text input)
  or `json_object` (multimodal models). `GROQ_MODEL` defaults to
  `qwen/qwen3.8-27b` (multimodal: text + up to 3 images per request).
  `openai/gpt-oss-20b` is text-input only and will reject image-based inputs —
  see the provider section above for scanned-PDF/image behavior.

If a model is deprecated or unsupported, set the model variable to a current
supported model — the code does not silently pick another model.

## Known limitations & demo mode

- Processing requires Inngest. Locally that means the Dev Server must be
  running; without it enqueue returns `503 ENQUEUE_FAILED` and the invoice is
  left retryable — it is never reported as completed. Production needs Inngest
  Cloud or a self-hosted Inngest server.
- PDFs are extracted in 3-page batches (one durable step each) and bounded by
  `MAX_PDF_PAGES` (default 10); `MAX_CONCURRENT_PROCESSING` caps concurrent
  jobs per user in both the UI and the Inngest function.
- Only PDF, JPEG, and PNG are accepted; PDF page limit is configurable.
- Gemini extraction quality depends on the model; validation never trusts model
  confidence scores.
- The accuracy report scores only fields present in `reviewed_data`, compares
  line items positionally only when both versions contain the same number of
  rows, and covers at most the 500 most recent approved invoices. It measures
  agreement with human review — it is not a substitute for a labelled benchmark.
- Use `AI_PROVIDER=mock` or the synthetic fixture (`fixtures/samples/`) for
  reproducible demos. No real invoices are committed to this repository.

## Vercel deployment

1. Import the repo into Vercel.
2. Add environment variables for each scope.
   - **Production**: the real Supabase URL/publishable key, service-role key,
     Gemini key, `NEXT_PUBLIC_SITE_URL`, model/page-limit settings, plus
     `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` (or point at a self-hosted
     Inngest server). Never set `AI_PROVIDER=mock` here (mock is for
     local/demo only).
   - **Preview**: a separate Supabase Preview/Test project if you want isolated
     data; otherwise the same variables (or a staging project).
   - **Development**: local `.env.local` values.
3. Register `https://<app>.vercel.app/api/inngest` with Inngest and confirm the
   `process-invoice` function syncs.
4. Deploy. Check `https://<app>.vercel.app/api/health` — the `readiness`
   block reports `supabaseConfigured`, `serverCredentialsConfigured`, and
   `extractionProvider` without exposing secrets.
5. Update Supabase Authentication → URL Configuration Site URL / redirect URLs
   to each environment origin (e.g. `https://<app>.vercel.app/**` and
   `http://localhost:3000/**`).

### Vercel function runtime

The Inngest route (`/api/inngest`) declares `maxDuration = 300`; it serves the
durable worker and each page batch is a separate step. On Vercel, use a plan
that allows that duration. The enqueue route is short-lived (`maxDuration = 15`)
and returns as soon as Inngest accepts the event. Uploads remain bounded by the
5 MB and `MAX_PDF_PAGES` limits.

## Roadmap

- Phase 0 — foundation (done).
- Phase 1 — authentication + dashboard shell (done).
- Phase 2 — upload, processing pipeline, validation, review (done).
- Phase 3 — search, settings, better line-item editing (done).
- Phase 4 — deeper AI evaluation and extraction-accuracy reporting (done).
- Phase 5 — optional n8n webhook integration (disabled by default).
