import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { renderPdfPagesToPng } from "@/lib/providers/groq";

const PNG_1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function makeTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText("INVOICE ACME", { x: 30, y: 250, size: 14, font, color: rgb(0, 0, 0) });
  return new Uint8Array(await doc.save());
}

async function makeImagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(PNG_1x1);
  const page = doc.addPage([300, 300]);
  page.drawImage(img, { x: 0, y: 0, width: 300, height: 300 });
  return new Uint8Array(await doc.save());
}

describe("real PDF page rendering (pdf-parse getScreenshot)", () => {
  it("renders a scanned-style image PDF to valid non-empty PNG buffers", async () => {
    const pdf = await makeImagePdf();
    const result = await renderPdfPagesToPng(pdf, 3);
    expect(result.pages.length).toBeGreaterThanOrEqual(1);
    for (const page of result.pages) {
      expect(page.png.byteLength).toBeGreaterThan(0);
      expect(Array.from(page.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    expect(result.failedPages).toEqual([]);
    expect(result.totalActual).toBeGreaterThanOrEqual(1);
  });

  it("renders a text PDF and reports its total pages", async () => {
    const pdf = await makeTextPdf();
    const result = await renderPdfPagesToPng(pdf, 5);
    expect(result.pages).toHaveLength(1);
    expect(result.totalActual).toBe(1);
    expect(result.failedPages).toEqual([]);
  });

  it("never renders more pages than requested", async () => {
    const pdf = await makeTextPdf();
    const result = await renderPdfPagesToPng(pdf, 1);
    expect(result.pages.length).toBeLessThanOrEqual(1);
  });
});
