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
              │  ├─ /api/invoices/:id/process   (secure processing)
              │  └─ /invoices/:id    (review UI)
              │
              ├─ Supabase Auth (SSR, PKCE)
              ├─ Supabase PostgreSQL + RLS
              ├─ Supabase Storage (private, owner-scoped signed URLs)
              └─ Extraction provider abstraction
                   ├─ Gemini (@google/genai, structured JSON)
                   └─ Mock (deterministic, demo mode)
```

The processing pipeline is modular and synchronous: authenticate → verify
ownership → claim ` → download from private storage → validate file signature /
size / page count → SHA-256 → duplicate checks → extract → normalize → validate →
persist → `needs_review` (never auto-approve).

## What works (Phase 2)

- Direct-to-Storage upload with server-validated upload-intent.
- Secure processing endpoint (atomic claim, idempotent, rate-limited via DB).
- Gemini extraction (structured output) with strict Zod validation + mock provider.
- Deterministic monetary validation (decimal.js) and duplicate detection.
- Invoice history, detail, and review UI (edit, save, approve, reject).
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
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for emails/redirects | Yes |

Service-role and AI provider keys (Gemini, Groq) are never exposed via
`NEXT_PUBLIC_*`.

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

## Demo mode (mock provider)

Set `AI_PROVIDER=mock` to run the whole workflow with a deterministic provider
that needs no API key and no network. The UI visibly labels results as
"Simulated extraction". There is no silent fallback from Gemini to mock.

## Tests

```bash
pnpm test          # mocked suite — no paid API calls, no live credentials
pnpm typecheck
pnpm lint
pnpm build
```

Test coverage includes: extraction schema parsing, missing fields, provider
error handling, PDF/PNG/JPEG validation, oversized/invalid files, PDF page
limits, decimal arithmetic/tolerance, duplicate file & supplier/number
detection, status transitions, concurrent claims, ownership checks, save /
approve / reject validation, dashboard metrics and empty states.

Live RLS integration tests (`tests/integration/rls.test.ts`) are gated on real
Supabase test credentials and skipped otherwise.

## Testing live extraction & the full flow

1. Configure Supabase + `GEMINI_API_KEY` (or leave `AI_PROVIDER=mock`).
2. Start the app and register/sign in.
3. Go to `/upload` and upload a small PDF/JPEG/PNG (≤5 MB, ≤10 pages).
4. The file is validated client + server side, uploaded to private storage, and
   processed. On success it lands in `/invoices/:id` as `needs_review`.
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
  reports field-level exact-match, missing-field, and validation behavior for
  synthetic invoices. Mock results are deterministic and asserted; live results
  are recorded (not fabricated) and are not auto-asserted to a target accuracy.

```bash
# Run everything offline (no paid calls):
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# Live Supabase integration (opt-in):
RUN_LIVE_INTEGRATION_TESTS=true pnpm test -- tests/integration/rls.test.ts

# Live Gemini smoke + evaluation (opt-in):
RUN_LIVE_GEMINI_TESTS=true GEMINI_API_KEY=... pnpm test -- tests/integration/live-gemini.test.ts tests/evaluation/extraction-accuracy.test.ts
```

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

- Processing is synchronous and bounded (`maxDuration` 60s on Vercel); very
  large documents may exceed the limit. Processing is rate-limited per user via
  the database (max concurrent), not an in-memory limiter.
- Only PDF, JPEG, and PNG are accepted; PDF page limit is configurable.
- Gemini extraction quality depends on the model; validation never trusts model
  confidence scores.
- Use `AI_PROVIDER=mock` or the synthetic fixture (`fixtures/samples/`) for
  reproducible demos. No real invoices are committed to this repository.

## Vercel deployment

1. Import the repo into Vercel.
2. Add environment variables for each scope.
   - **Production**: the real Supabase URL/publishable key, service-role key,
     Gemini key, `NEXT_PUBLIC_SITE_URL`, model/page-limit settings. Never set
     `AI_PROVIDER=mock` here (mock is for local/demo only).
   - **Preview**: a separate Supabase Preview/Test project if you want isolated
     data; otherwise the same variables (or a staging project).
   - **Development**: local `.env.local` values.
3. Deploy. Check `https://<app>.vercel.app/api/health` — the `readiness`
   block reports `supabaseConfigured`, `serverCredentialsConfigured`, and
   `extractionProvider` without exposing secrets.
4. Update Supabase Authentication → URL Configuration Site URL / redirect URLs
   to each environment origin (e.g. `https://<app>.vercel.app/**` and
   `http://localhost:3000/**`).

### Vercel function runtime

The processing endpoint declares `maxDuration = 60` (Node runtime). On Vercel:
enable Fluid compute (or a plan that allows ≥ 60s) for that route; otherwise the
function may be terminated for long documents. Processing is synchronous and
bounded by direct, 5 MB, and 10-page limits (all configurable).

## Roadmap

- Phase 0 — foundation (done).
- Phase 1 — authentication + dashboard shell (done).
- Phase 2 — upload, processing pipeline, validation, review (done).
- Phase 3 — search, settings, better line-item editing.
- Phase 4 — deeper AI evaluation and extraction-accuracy reporting.
- Phase 5 — optional n8n webhook integration (disabled by default).
