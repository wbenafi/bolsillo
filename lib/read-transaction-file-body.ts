import type { Readable } from "node:stream";
import { ConvexError } from "convex/values";

import { MAX_TRANSACTION_FILE_BYTES } from "./transaction-files";

/** Read an S3 Node response with a fixed allocation and an enforced byte limit. */
export async function readTransactionFileBody(
  body: Readable,
  contentLength: number | undefined,
  expectedSize: number,
): Promise<Uint8Array> {
  function invalidSize(): never {
    throw new ConvexError({
      code: "FILE_VALIDATION_ERROR",
      message: "El tamaño del archivo no coincide con la carga o supera los 2 MB permitidos.",
    });
  }

  try {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_TRANSACTION_FILE_BYTES) {
      invalidSize();
    }
    // Reject large objects before consuming the response. Still bound the stream
    // independently: Content-Length can be missing or incorrect.
    if (contentLength !== undefined && contentLength !== expectedSize) invalidSize();
    const bytes = new Uint8Array(expectedSize);
    let offset = 0;
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > expectedSize - offset) invalidSize();
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (offset !== expectedSize) invalidSize();
    return bytes;
  } finally {
    // Release the socket on header rejection, overflow, stream errors and success.
    body.destroy();
  }
}
