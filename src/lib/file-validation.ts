import { PDFDocument } from "pdf-lib";

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type FileValidationErrorCode =
  | "unsupported_extension"
  | "mime_mismatch"
  | "too_large"
  | "invalid_signature"
  | "malformed_pdf"
  | "pdf_too_many_pages";

export class FileValidationError extends Error {
  constructor(readonly code: FileValidationErrorCode, message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx + 1).toLowerCase();
}

function isAllowedMime(mime: string): boolean {
  return mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png";
}

/** Magic-byte signature sniffing. Never trust the filename or browser MIME. */
export function sniffSignature(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "application/pdf";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  return null;
}

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

export interface ValidatedFile {
  bytes: Uint8Array;
  size: number;
  actualMimeType: string;
  pageCount: number | null;
}

export async function validateUploadedFile(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
  maxSizeBytes?: number;
  maxPdfPages?: number;
}): Promise<ValidatedFile> {
  const maxSize = input.maxSizeBytes ?? MAX_FILE_SIZE_BYTES;
  const maxPdfPages = input.maxPdfPages ?? 10;
  const ext = getExtension(input.filename);

  if (!EXT_TO_MIME[ext]) {
    throw new FileValidationError("unsupported_extension", "Only PDF, JPEG, and PNG files are supported.");
  }
  if (!isAllowedMime(input.declaredMimeType)) {
    throw new FileValidationError("mime_mismatch", "Unsupported file type.");
  }
  if (input.bytes.byteLength > maxSize) {
    throw new FileValidationError("too_large", `File exceeds the ${Math.floor(maxSize / 1024 / 1024)} MB limit.`);
  }

  const actual = sniffSignature(input.bytes);
  if (!actual) {
    throw new FileValidationError("invalid_signature", "The file does not match a supported document signature.");
  }
  if (actual !== input.declaredMimeType) {
    // Strict: signature must match the declared type to avoid spoofed MIME.
    throw new FileValidationError("mime_mismatch", "File signature does not match its declared type.");
  }

  let pageCount: number | null = null;
  if (actual === "application/pdf") {
    try {
      pageCount = await countPdfPages(input.bytes);
    } catch {
      throw new FileValidationError("malformed_pdf", "The PDF is malformed or unsupported.");
    }
    if (pageCount > maxPdfPages) {
      throw new FileValidationError("pdf_too_many_pages", `PDF exceeds the ${maxPdfPages}-page limit.`);
    }
  }

  return {
    bytes: input.bytes,
    size: input.bytes.byteLength,
    actualMimeType: actual,
    pageCount,
  };
}
