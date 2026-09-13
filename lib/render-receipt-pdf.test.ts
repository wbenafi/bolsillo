import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderReceiptPdf } from "./render-receipt-pdf";

function pdf(pages: number) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pages} >>`];
  for (let i = 0; i < pages; i++) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents ${pages + 3} 0 R >>`);
  const content = "0.1 0.4 0.3 rg 20 20 200 200 re f";
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(source));
}
describe("PDF receipt preparation", () => {
  it("renders every page as a bounded readable JPEG", async () => {
    const images = await renderReceiptPdf(pdf(2), 10);
    expect(images).toHaveLength(2);
    const metadata = await sharp(images[0]).metadata();
    expect(metadata.format).toBe("jpeg"); expect(metadata.width).toBe(600); expect(metadata.height).toBe(800);
  });
  it("rejects excess pages instead of silently dropping part of a receipt", async () => {
    await expect(renderReceiptPdf(pdf(2), 1)).rejects.toThrow("page limit");
    await expect(renderReceiptPdf(pdf(11), 10)).rejects.toThrow("page limit");
  });
  it("rejects a corrupt PDF", async () => { await expect(renderReceiptPdf(new Uint8Array(Buffer.from("%PDF-1.7\ninvalid")), 10)).rejects.toThrow(); });
});
