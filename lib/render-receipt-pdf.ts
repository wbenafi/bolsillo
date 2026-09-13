/** Node-only. Render all pages; never silently truncate a receipt. */
export async function renderReceiptPdf(bytes: Uint8Array, maxPages: number): Promise<Buffer[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, stopAtErrors: true, maxImageSize: 40_000_000 });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > maxPages) throw new Error("PDF page limit");
    const images: Buffer[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1800 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width < 1 || viewport.height < 1) throw new Error("Invalid PDF dimensions");
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
      images.push(await canvas.encode("jpeg", 85));
      page.cleanup();
    }
    return images;
  } finally { await loading.destroy(); }
}
