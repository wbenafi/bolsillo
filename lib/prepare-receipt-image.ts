/** Node-only: preserve receipt text instead of recompressing already bounded uploads. */
import sharp from "sharp";

export async function prepareReceiptImage(bytes: Uint8Array) {
  const original = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const image = sharp(original, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  const mimeTypes: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  const mimeType = mimeTypes[metadata.format ?? ""];
  if (!mimeType || !metadata.width || !metadata.height) throw new Error("Invalid receipt image");
  const oriented = metadata.orientation && metadata.orientation !== 1;
  return { bytes: oriented ? await image.rotate().toBuffer() : original, mimeType };
}
