import { afterEach, expect, it, vi } from "vitest";
import { uploadTransactionFile } from "./upload-transaction-file";

afterEach(() => vi.unstubAllGlobals());

it("bounds upload requests and preserves the signed headers and file bytes", async () => {
  const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", transport);
  const file = new File(["comprobante"], "recibo.txt", { type: "text/plain" });
  const headers = { "Content-Type": file.type, "If-None-Match": "*" };
  await uploadTransactionFile("https://storage.test/signed", headers, file);
  expect(transport).toHaveBeenCalledWith("https://storage.test/signed", {
    method: "PUT", headers, body: file, signal: expect.any(AbortSignal),
  });
});

it.each(["network", "timeout", "rejected"])("shows an actionable message after a %s failure without retrying a PUT", async failure => {
  const transport = vi.fn<typeof fetch>(async () => {
    if (failure === "network") throw new TypeError("Failed to fetch");
    if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
    return new Response(null, { status: 403 });
  });
  vi.stubGlobal("fetch", transport);
  await expect(uploadTransactionFile("https://storage.test/signed", {}, new File(["test"], "recibo.txt")))
    .rejects.toThrow("volvé a seleccionarlo para reintentar");
  expect(transport).toHaveBeenCalledTimes(1);
});
