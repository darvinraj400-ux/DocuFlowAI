"use client";

import { useState } from "react";
import { ChevronDown, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExtractionResult } from "@/lib/pipeline/schema";

interface Props {
  extraction: Partial<ExtractionResult> | null;
}

function coverageBadge(capture: ExtractionResult["capture"] | null | undefined) {
  const cov = capture?.coverage;
  if (!cov) return <Badge variant="secondary">No coverage report</Badge>;
  if (cov.complete === false || (cov.pagesFailed ?? 0) > 0) {
    return <Badge variant="warning">Partial extraction</Badge>;
  }
  const processedTxt = cov.pagesProcessed ?? "?";
  return <Badge variant="info">Complete ({cov.pagesTotal != null ? `${processedTxt}/${cov.pagesTotal}` : processedTxt})</Badge>;
}

export function ExtractionInventory({ extraction }: Props) {
  const [open, setOpen] = useState(false);
  if (!extraction) return null;
  const capture = extraction.capture ?? null;
  const additional = extraction.additional_fields ?? {};
  const rawInput = additional.raw_input;

  const additionalEntries = Object.entries(additional).filter(([key]) => key !== "raw_input");
  const pages = capture?.pages ?? [];
  const fullText = capture?.fullText ?? null;
  const evidence = capture?.evidence ?? null;

  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
          Raw extraction &amp; coverage
        </span>
        <span className="inline-flex items-center gap-2">
          {coverageBadge(capture)}
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          {capture?.coverage && (
            <dl className="grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
              <div><dt className="text-xs">Pages total</dt><dd className="text-foreground">{capture.coverage.pagesTotal ?? "—"}</dd></div>
              <div><dt className="text-xs">Pages processed</dt><dd className="text-foreground">{capture.coverage.pagesProcessed ?? "—"}</dd></div>
              <div><dt className="text-xs">Pages failed</dt><dd className="text-foreground">{capture.coverage.pagesFailed ?? 0}</dd></div>
              <div><dt className="text-xs">Complete</dt><dd className="text-foreground">{capture.coverage.complete === true ? "Yes" : "No"}</dd></div>
            </dl>
          )}

          {pages.length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pages</h4>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {pages.map((page, i) => (
                  <li key={i} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Page {page.page}</span>
                      <span className="flex items-center gap-2">
                        {page.extracted === false && <Badge variant="warning">Not extracted</Badge>}
                        {page.truncated === true && <Badge variant="secondary">Truncated</Badge>}
                        <span className="text-xs text-muted-foreground">images: {page.images ?? 0}</span>
                      </span>
                    </div>
                    {page.note && <p className="mt-1 text-muted-foreground">{page.note}</p>}
                    {page.text && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-xs">{page.text}</pre>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fullText && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Full text</h4>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-3 text-xs">{fullText}</pre>
            </div>
          )}

          {evidence && Object.keys(evidence).length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Field evidence</h4>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {Object.entries(evidence).map(([key, value]) => (
                  <li key={key} className="flex justify-between gap-2">
                    <span>{key}</span>
                    <span className="text-xs">{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {additionalEntries.length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Unmapped / additional fields ({additionalEntries.length})
              </h4>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {additionalEntries.map(([key, value]) => (
                  <li key={key} className="flex justify-between gap-2">
                    <span>{key}</span>
                    <span className="max-w-[60%] truncate text-right text-xs">{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rawInput !== undefined && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Raw model input (original JSON)</h4>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-3 text-xs">{JSON.stringify(rawInput, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
