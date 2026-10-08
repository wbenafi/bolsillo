/** Server-only provider transport. No file writes or accounting mutations. */
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { extractionSchema, extractionSystemPrompt } from "./transaction-extraction";

export type ReceiptContent = OpenAI.Responses.ResponseInputText | OpenAI.Responses.ResponseInputImage;
export type ReceiptResponse = Pick<OpenAI.Responses.Response, "status" | "output" | "output_text" | "usage">;

export function createReceiptClient(apiKey: string, transport?: typeof fetch) {
  if (!apiKey.trim()) throw new Error("Invalid OpenAI configuration");
  return new OpenAI({ apiKey: apiKey.trim(), maxRetries: 0, timeout: 30_000, fetch: transport });
}

export async function requestReceipt(client: OpenAI, content: ReceiptContent[]) {
  return client.responses.create({
    model: "gpt-6-luna",
    store: false,
    max_output_tokens: 8192,
    reasoning: { effort: "low" },
    text: { format: zodTextFormat(extractionSchema, "receipt_extraction") },
    instructions: extractionSystemPrompt,
    input: [{ role: "user", content }],
  });
}

/** Read output text and reject incomplete/refused replies without losing usage. */
export function parseReceiptResponse(response: ReceiptResponse): unknown {
  if (response.status !== "completed" || response.output.some(item => item.type === "message" && item.content.some(block => block.type === "refusal"))) return null;
  try { return JSON.parse(response.output_text); } catch { return null; }
}

export function receiptUsage(response: ReceiptResponse, inputRate?: string, outputRate?: string) {
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const inRate = inputRate?.trim() ? Number(inputRate) : NaN;
  const outRate = outputRate?.trim() ? Number(outputRate) : NaN;
  const costUsd = response.usage && Number.isFinite(inRate) && inRate >= 0 && Number.isFinite(outRate) && outRate >= 0
    ? (inputTokens * inRate + outputTokens * outRate) / 1e6 : undefined;
  return { inputTokens, outputTokens, costUsd };
}
