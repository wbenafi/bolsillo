import sharp from "sharp";
import { expect, it } from "vitest";
import { prepareReceiptImage } from "./prepare-receipt-image";

it.each(["jpeg", "png", "webp"] as const)("preserves %s pixels and bytes without resizing or recompression", async format => {
  const input = await sharp({ create: { width: 2500, height: 400, channels: 3, background: "white" } }).toFormat(format).toBuffer();
  const result = await prepareReceiptImage(input);
  expect(result.bytes.equals(input)).toBe(true);
  expect(result.mimeType).toBe(`image/${format}`);
});
it("honors EXIF orientation without shrinking the receipt", async () => {
  const input = await sharp({ create: { width: 2500, height: 400, channels: 3, background: "white" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepareReceiptImage(input);
  const metadata = await sharp(result.bytes).metadata();
  expect(metadata.width).toBe(400);
  expect(metadata.height).toBe(2500);
});
