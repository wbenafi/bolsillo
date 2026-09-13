import { describe, expect, it, vi } from "vitest";
import { createReceiptClient, requestReceipt } from "./qwen-receipt-client";

describe("Qwen OpenAI-compatible transport", () => {
  it("sends the exact selected model, image bytes, JSON format and bounded output", async () => {
    let body: Record<string, unknown> = {};
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://provider.test/v1/chat/completions");
      body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ id: "receipt-test", object: "chat.completion", model: "qwen3.8-flash", created: 0, choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }), { headers: { "content-type": "application/json" } });
    });
    const response = await requestReceipt(createReceiptClient("test-key", "https://provider.test/v1", transport), [{ type: "text", text: "Archivo 1" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,dGVzdA==" } }]);
    expect(body).toMatchObject({ model: "qwen3.8-flash", reasoning_effort: "low", max_tokens: 4096, response_format: { type: "json_object" } });
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain("data:image/jpeg;base64,");
    expect(response.usage?.prompt_tokens).toBe(120);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("never silently retries a billable provider request", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { message: "Busy", type: "rate_limit_error" } }), { status: 429, headers: { "content-type": "application/json" } }));
    await expect(requestReceipt(createReceiptClient("test-key", "https://provider.test/v1", transport), [{ type: "text", text: "Receipt" }])).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects insecure or credential-bearing endpoint URLs", () => {
    for (const url of ["http://provider.test/v1", "https://user:password@provider.test/v1", "https://provider.test/v1?key=secret"]) expect(() => createReceiptClient("test-key", url)).toThrow();
  });
});
