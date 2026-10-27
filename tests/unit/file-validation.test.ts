import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  FileValidationError,
  validateUploadedFile,
  sniffSignature,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/file-validation";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([400, 600]);
  return doc.save();
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("file validation", () => {
  it("sniffs PDF, JPEG, and PNG signatures", () => {
    expect(sniffSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffSignature(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffSignature(PNG_BYTES)).toBe("image/png");
    expect(sniffSignature(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("validates a real PDF within the page limit", async () => {
    const bytes = await makePdf(1);
    const result = await validateUploadedFile({ bytes, filename: "invoice.pdf", declaredMimeType: "application/pdf", maxPdfPages: 10 });
    expect(result.actualMimeType).toBe("application/pdf");
    expect(result.pageCount).toBe(1);
  });

  it("rejects a PDF over the page limit", async () => {
    const bytes = await makePdf(12);
    await expect(validateUploadedFile({ bytes, filename: "big.pdf", declaredMimeType: "application/pdf", maxPdfPages: 10 })).rejects.toThrow(FileValidationError);
  });

  it("rejects files over the size limit", async () => {
    const bytes = new Uint8Array(MAX_FILE_SIZE_BYTES + 1).fill(0);
    await expect(validateUploadedFile({ bytes, filename: "large.pdf", declaredMimeType: "application/pdf" })).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects invalid signatures", async () => {
    const bytes = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44]);
    await expect(validateUploadedFile({ bytes, filename: "fake.pdf", declaredMimeType: "application/pdf" })).rejects.toMatchObject({ code: "invalid_signature" });
  });

  it("rejects MIME/signature mismatches", async () => {
    await expect(validateUploadedFile({ bytes: JPEG_BYTES, filename: "photo.png", declaredMimeType: "image/png" })).rejects.toMatchObject({ code: "mime_mismatch" });
  });

  it("validates a PNG", async () => {
    const result = await validateUploadedFile({ bytes: PNG_BYTES, filename: "scan.png", declaredMimeType: "image/png" });
    expect(result.actualMimeType).toBe("image/png");
  });
});
