/** Server-only provider transport. No file writes or accounting mutations. */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema, extractionSystemPrompt } from "./transaction-extraction";

export type ReceiptContent = Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam;
export type ReceiptResponse = Pick<Anthropic.Messages.Message, "stop_reason" | "content" | "usage">;

export function createReceiptClient(apiKey: string, transport?: typeof fetch) {
  if (!apiKey.trim()) throw new Error("Invalid Anthropic configuration");
  return new Anthropic({ apiKey: apiKey.trim(), maxRetries: 0, timeout: 30_000, fetch: transport });
}

export async function requestReceipt(client: Anthropic, content: ReceiptContent[]) {
  return client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(extractionSchema) },
    system: extractionSystemPrompt,
    messages: [{ role: "user", content }],
  });
}

/** Ignore thinking blocks and reject truncated/refused replies without losing usage. */
export function parseReceiptResponse(response: ReceiptResponse): unknown {
  if (response.stop_reason !== "end_turn") return null;
  const text = response.content.filter(block => block.type === "text").map(block => block.text).join("");
  try { return JSON.parse(text); } catch { return null; }
}

export function receiptUsage(response: ReceiptResponse, inputRate?: string, outputRate?: string) {
  const inputTokens = response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
  const outputTokens = response.usage.output_tokens;
  const inRate = inputRate?.trim() ? Number(inputRate) : NaN;
  const outRate = outputRate?.trim() ? Number(outputRate) : NaN;
  const costUsd = Number.isFinite(inRate) && inRate >= 0 && Number.isFinite(outRate) && outRate >= 0
    ? (inputTokens * inRate + outputTokens * outRate) / 1e6 : undefined;
  return { inputTokens, outputTokens, costUsd };
}
