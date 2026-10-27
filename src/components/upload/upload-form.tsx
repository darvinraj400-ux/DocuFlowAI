"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png"];
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];

type Step = "idle" | "reserving" | "uploading" | "processing" | "done";

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  function acceptFile(candidate: File) {
    const ext = extOf(candidate.name);
    if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(candidate.type)) {
      setError("Unsupported file. Please upload a PDF, JPG, or PNG.");
      return;
    }
    if (candidate.size > MAX_SIZE) {
      setError("File is larger than the 5 MB limit.");
      return;
    }
    setError(null);
    setFile(candidate);
    setStep("idle");
  }

  async function runUpload() {
    if (!file) return;
    setStep("reserving");
    setError(null);

    // TEMP DIAG: track which step throws so the failing stage is identifiable.
    let stage = "reserve";
    try {
      const reserve = await fetch("/api/invoices/upload-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      const reserveBody = await reserve.json();
      if (!reserve.ok) {
        setError(reserveBody.error ?? "Could not reserve the upload.");
        setStep("idle");
        return;
      }

      const { invoiceId: id, storagePath } = reserveBody;
      setInvoiceId(id);

      setStep("uploading");
      stage = "storage";
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(storagePath, file, { contentType: file.type, upsert: false });

      if (uploadError) {
        setError("Upload to secure storage failed. You can retry, or mark this upload as failed.");
        setStep("idle");
        return;
      }

      setStep("processing");
      stage = "process";
      const processRes = await fetch(`/api/invoices/${id}/process`, { method: "POST" });
      const processBody = await processRes.json();

      if (!processRes.ok) {
        // TEMP DIAG: pathname and status only — never the full URL, headers,
        // or body contents.
        try {
          console.error("[upload-diag] processResponse", {
            pathname: new URL(processRes.url).pathname,
            status: processRes.status,
          });
        } catch {
          console.error("[upload-diag] processResponse", { status: processRes.status });
        }
        setError(processBody.error ?? "Processing failed. The invoice was marked as failed and can be retried.");
        setStep("idle");
        return;
      }

      setStep("done");
      router.push(`/invoices/${id}`);
      router.refresh();
    } catch (error) {
      // TEMP DIAG: console-only; never log file contents, cookies, or tokens.
      console.error(`[upload-diag] stage=${stage}`, error instanceof Error ? error.message : String(error));
      setError("An unexpected error occurred. Please try again.");
      setStep("idle");
      // If a record was already reserved, do not leave an orphaned "uploaded"
      // row behind: mark it failed through the authorized server route.
      if (invoiceId) {
        void markFailed();
      }
    }
  }

  async function markFailed() {
    if (!invoiceId) return;
    try {
      await fetch(`/api/invoices/${invoiceId}/fail`, { method: "POST" });
    } finally {
      setFile(null);
      setInvoiceId(null);
      setStep("idle");
      router.refresh();
    }
  }

  const busy = step === "reserving" || step === "uploading" || step === "processing";

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          {invoiceId && (
            <div className="mt-2">
              <Button type="button" variant="outline" size="sm" onClick={markFailed}>
                Mark this upload as failed
              </Button>
            </div>
          )}
        </Alert>
      )}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) acceptFile(dropped);
        }}
        className="rounded-xl border-2 border-dashed border-border bg-muted/20 p-10 text-center"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) acceptFile(picked);
          }}
        />
        <FileUp className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm text-muted-foreground">
          Drag and drop an invoice here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-primary underline underline-offset-4"
          >
            browse
          </button>{" "}
          for a file.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, JPG, or PNG · up to 5 MB · max 10 pages
        </p>
      </div>

      {file && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <div className="flex items-center gap-2">
            {busy ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {step === "reserving" && "Reserving upload…"}
                {step === "uploading" && "Uploading to secure storage…"}
                {step === "processing" && "Processing with AI…"}
              </span>
            ) : (
              <Button type="button" onClick={runUpload}>
                Upload & process
              </Button>
            )}
            {!busy && (
              <Button type="button" variant="ghost" size="icon" onClick={() => { setFile(null); setError(null); }} aria-label="Remove file">
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
