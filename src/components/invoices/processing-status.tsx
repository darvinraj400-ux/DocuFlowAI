"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  nextPollAction,
  nextPollDelayMs,
  type InvoiceProgress,
  type PollAction,
} from "@/lib/invoice-progress";

const PHASE_LABELS: Record<InvoiceProgress["phase"], string> = {
  queued: "Queued",
  processing: "Processing",
  needs_review: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
};

export function ProcessingStatus({
  invoiceId,
  initial,
}: {
  invoiceId: string;
  initial: InvoiceProgress;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [pollError, setPollError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);
  const startedAtRef = useRef(0);
  const refreshedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    clearTimer();

    const tick = async () => {
      if (!mountedRef.current) return;

      const before = nextPollAction({
        attempt: attemptRef.current,
        elapsedMs: Date.now() - startedAtRef.current,
        terminal: false,
      });
      if (before.kind === "stop") {
        setTimedOut(true);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let decision: PollAction | null = null;

      try {
        const response = await fetch(`/api/invoices/${invoiceId}/status`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 404) {
          if (mountedRef.current) {
            setPollError("You no longer have access to this invoice.");
            setTimedOut(true);
          }
          return;
        }
        if (!response.ok) throw new Error("status request failed");

        const next = (await response.json()) as InvoiceProgress;
        if (!mountedRef.current) return;

        setProgress(next);
        setPollError(null);

        decision = nextPollAction({
          attempt: attemptRef.current,
          elapsedMs: Date.now() - startedAtRef.current,
          httpStatus: response.status,
          terminal: next.terminal,
        });

        if (decision.kind === "stop") {
          if (
            decision.reason === "terminal" &&
            !refreshedRef.current &&
            (next.status === "needs_review" ||
              next.status === "approved" ||
              next.status === "rejected")
          ) {
            refreshedRef.current = true;
            router.refresh();
          }
          if (decision.reason === "expired") setTimedOut(true);
          return;
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || !mountedRef.current) return;
        setPollError("Progress could not be refreshed; retrying…");
        decision = nextPollAction({
          attempt: attemptRef.current,
          elapsedMs: Date.now() - startedAtRef.current,
          terminal: false,
        });
        if (decision.kind === "stop") {
          setTimedOut(true);
          return;
        }
      }

      if (!mountedRef.current || !decision || decision.kind !== "continue") return;
      attemptRef.current = decision.attempt;
      timerRef.current = setTimeout(tick, decision.delayMs);
    };

    timerRef.current = setTimeout(tick, nextPollDelayMs(0));
  }, [clearTimer, invoiceId, router]);

  useEffect(() => {
    mountedRef.current = true;
    startedAtRef.current = Date.now();
    if (!initial.terminal) startPolling();

    return () => {
      mountedRef.current = false;
      clearTimer();
      abortRef.current?.abort();
    };
  }, [clearTimer, initial.terminal, startPolling]);

  function restartPolling() {
    attemptRef.current = 0;
    startedAtRef.current = Date.now();
    setTimedOut(false);
    setPollError(null);
    startPolling();
  }

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/process`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setRetryError(body.error ?? "Processing could not be queued.");
        return;
      }

      setProgress((current) => ({
        ...current,
        status: "uploaded",
        phase: "queued",
        terminal: false,
        batchesTotal: null,
        batchesCompleted: 0,
        pagesTotal: null,
        pagesProcessed: 0,
        message: "Queued — waiting for a processing slot.",
      }));
      refreshedRef.current = false;
      restartPolling();
    } catch {
      setRetryError("Processing could not be queued.");
    } finally {
      if (mountedRef.current) setRetrying(false);
    }
  }

  const active = !progress.terminal && !timedOut;
  const badgeVariant =
    progress.status === "failed"
      ? "destructive"
      : progress.status === "needs_review"
        ? "warning"
        : progress.status === "approved" || progress.status === "rejected"
          ? "secondary"
          : "info";

  return (
    <div className="space-y-3 rounded-xl border border-border p-4 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={badgeVariant}>{PHASE_LABELS[progress.phase]}</Badge>
        {active && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {progress.phase === "queued" ? "Waiting to start" : "Working"}
          </span>
        )}
      </div>

      {progress.message && <p className="text-muted-foreground">{progress.message}</p>}

      {progress.pagesTotal != null && progress.pagesTotal > 0 && (
        <p className="text-xs text-muted-foreground">
          {progress.pagesProcessed} of {progress.pagesTotal} pages processed
        </p>
      )}

      {pollError && <p className="text-xs text-muted-foreground">{pollError}</p>}

      {timedOut && progress.status !== "failed" && (
        <Alert variant="info">
          <AlertTitle>Still processing</AlertTitle>
          <AlertDescription>
            This is taking longer than expected. You can check again or come back later.
            <div className="mt-2">
              <Button type="button" variant="outline" size="sm" onClick={restartPolling}>
                Check again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {progress.status === "failed" && (
        <div className="space-y-2">
          {retryError && <p className="text-xs text-destructive">{retryError}</p>}
          <Button type="button" size="sm" onClick={retry} disabled={retrying}>
            {retrying ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Retry processing
          </Button>
        </div>
      )}
    </div>
  );
}
