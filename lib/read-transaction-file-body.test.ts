import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { readTransactionFileBody } from "./read-transaction-file-body";
import { MAX_TRANSACTION_FILE_BYTES } from "./transaction-files";

describe("bounded R2 response reading", () => {
  it("accepts a file at the exact limit across multiple chunks", async () => {
    const data = Buffer.alloc(MAX_TRANSACTION_FILE_BYTES, 65);
    const body = Readable.from([data.subarray(0, 100), data.subarray(100)]);
    const result = await readTransactionFileBody(body, data.length, data.length);
    expect(Buffer.from(result).equals(data)).toBe(true);
    expect(body.destroyed).toBe(true);
  });

  it("rejects an oversized Content-Length before consuming any bytes", async () => {
    const read = vi.fn();
    const body = new Readable({ read });
    await expect(readTransactionFileBody(body, MAX_TRANSACTION_FILE_BYTES + 1, 24)).rejects.toThrow("tamaño");
    expect(read).not.toHaveBeenCalled();
    expect(body.destroyed).toBe(true);
  });

  it.each([undefined, 24])("stops a stream that exceeds its declared upload size (header %s)", async (contentLength) => {
    let produced = 0;
    const body = new Readable({
      highWaterMark: 1,
      read() { produced++; this.push(Buffer.alloc(16)); },
    });
    await expect(readTransactionFileBody(body, contentLength, 24)).rejects.toThrow("tamaño");
    expect(body.destroyed).toBe(true);
    // The source is unbounded, but consumption must stop near the byte limit.
    expect(produced).toBeLessThanOrEqual(4);
  });

  it("rejects a truncated stream even with a matching Content-Length", async () => {
    const body = Readable.from([Buffer.alloc(12)]);
    await expect(readTransactionFileBody(body, 24, 24)).rejects.toThrow("tamaño");
    expect(body.destroyed).toBe(true);
  });

  it("accepts a correctly sized stream without Content-Length", async () => {
    const body = Readable.from([Buffer.from("test")]);
    expect(await readTransactionFileBody(body, undefined, 4)).toEqual(new TextEncoder().encode("test"));
  });

  it("closes the response when its transport fails", async () => {
    const body = new Readable({ read() { this.destroy(new Error("connection reset")); } });
    await expect(readTransactionFileBody(body, 24, 24)).rejects.toThrow("connection reset");
    expect(body.destroyed).toBe(true);
  });

  it.each([0, -1, 1.5, MAX_TRANSACTION_FILE_BYTES + 1])("rejects invalid expected size %s before reading", async (expectedSize) => {
    const read = vi.fn();
    const body = new Readable({ read });
    await expect(readTransactionFileBody(body, undefined, expectedSize)).rejects.toThrow("tamaño");
    expect(read).not.toHaveBeenCalled();
    expect(body.destroyed).toBe(true);
  });
});
