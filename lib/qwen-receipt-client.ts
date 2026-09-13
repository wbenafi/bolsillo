/** Server-only provider transport. No file writes or accounting mutations. */
import OpenAI from "openai";
import { extractionSystemPrompt } from "./transaction-extraction";

export function createReceiptClient(apiKey: string, baseURL: string, transport?: typeof fetch) {
  const url = new URL(baseURL);
  if (!apiKey.trim() || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid Qwen configuration");
  return new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 30_000, fetch: transport });
}
export async function requestReceipt(client: OpenAI, content: OpenAI.Chat.Completions.ChatCompletionContentPart[]) {
  return client.chat.completions.create({
    model: "qwen3.8-flash",
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    max_tokens: 4096,
    messages: [{ role: "system", content: extractionSystemPrompt }, { role: "user", content }],
  });
}
