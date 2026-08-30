import { describe, expect, it } from "vitest";

import { contentMatchesFileType } from "./transaction-file-content";
import {
  MAX_TRANSACTION_FILE_BYTES,
  normalizedTransactionFileType,
  transactionFileTypeForName,
} from "./transaction-files";

describe("transaction files", () => {
  it("normalizes only matching supported extensions and MIME types", () => {
    expect(transactionFileTypeForName("factura.PDF")).toBe("application/pdf");
    expect(normalizedTransactionFileType({ name: "nota.txt", type: "" })).toBe("text/plain");
    expect(normalizedTransactionFileType({ name: "foto.jpg", type: "image/jpeg" })).toBe("image/jpeg");
    expect(normalizedTransactionFileType({ name: "foto.jpg", type: "image/png" })).toBeUndefined();
    expect(normalizedTransactionFileType({ name: "archivo.docx", type: "application/octet-stream" })).toBeUndefined();
    expect(MAX_TRANSACTION_FILE_BYTES).toBe(2 * 1024 * 1024);
  });

  it("recognizes the allowed binary signatures and safe UTF-8 text", () => {
    expect(contentMatchesFileType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true);
    expect(contentMatchesFileType(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")).toBe(true);
    expect(contentMatchesFileType(new TextEncoder().encode("Detalle de la compra\n"), "text/plain")).toBe(true);
    expect(contentMatchesFileType(Uint8Array.from([0x89, 0x50, 0x4e]), "image/png")).toBe(false);
    expect(contentMatchesFileType(Uint8Array.from([0x00, 0x01]), "text/plain")).toBe(false);
  });
});
