import { MAX_TRANSACTION_FILE_BYTES, normalizedTransactionFileType } from "./transaction-files";

export async function prepareReceiptFile(file: File): Promise<File> {
  if (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/.test(file.type)) throw new Error("Esta foto está en formato HEIC. Elegí una versión JPG o tomá otra foto en formato compatible.");
  const type = normalizedTransactionFileType(file);
  if (!type) throw new Error("Elegí una foto JPG, PNG o WebP, un PDF o un TXT.");
  if (file.size < 1) throw new Error("Este archivo está vacío.");
  if (!type.startsWith("image/")) {
    if (file.size > MAX_TRANSACTION_FILE_BYTES) throw new Error("Cada PDF o TXT debe pesar 2 MB o menos.");
    return new File([file], file.name, { type });
  }
  if (file.size > 20 * 1024 * 1024) throw new Error("La foto es demasiado grande. Elegí una de hasta 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("La foto es demasiado grande. Elegí una de menor resolución.");
    if (file.size <= MAX_TRANSACTION_FILE_BYTES) return new File([file], file.name, { type });
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No pudimos preparar la foto.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.82, 0.75]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_TRANSACTION_FILE_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
    }
    throw new Error("No pudimos reducir la foto conservando su calidad. Probá con una foto más cercana del comprobante.");
  } finally { bitmap.close(); }
}
