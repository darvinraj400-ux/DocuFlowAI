import type { Metadata } from "next";
import { UploadForm } from "@/components/upload/upload-form";

export const metadata: Metadata = {
  title: "Upload · DocuFlow AI",
};

export default function UploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload an invoice</h1>
        <p className="text-sm text-muted-foreground">
          Upload a supplier invoice. It is stored privately, then processed with AI
          before it lands in your review queue.
        </p>
      </div>
      <UploadForm />
    </div>
  );
}
