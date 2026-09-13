"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { browserFileUrl, r2Configuration, verifiedR2File } from "./r2";
import { parseExtractionResponse, normalizeExtraction } from "../lib/transaction-extraction";
import { prepareReceiptImage } from "../lib/prepare-receipt-image";
import { createReceiptClient, requestReceipt } from "../lib/qwen-receipt-client";
import { renderReceiptPdf } from "../lib/render-receipt-pdf";

export const verifyUpload = action({ args: { draftId: v.id("transactionDrafts"), batchId: v.id("fileUploadBatches") }, handler: async (ctx, { draftId, batchId }): Promise<Id<"transactionFiles">[]> => {
  const { batch, files } = await ctx.runQuery(internal.transactionFiles.getBatchForUpload, { batchId });
  if (batch.draftId !== draftId || batch.status !== "pending" || batch.expiresAt <= Date.now()) throw new Error("La carga ya no está disponible.");
  const { client, bucket } = r2Configuration();
  const verified = [];
  for (const file of files) {
    const data = await verifiedR2File(client, bucket, file);
    verified.push({ fileId: file._id, etag: data.etag ?? "verified" });
  }
  return ctx.runMutation(internal.transactionDrafts.verifiedFiles, { draftId, batchId, files: verified });
} });
export const readDraftFile = action({ args: { draftId: v.id("transactionDrafts"), fileId: v.id("transactionFiles") }, handler: async (ctx, args): Promise<{ url: string }> => {
  const file = await ctx.runQuery(internal.transactionDrafts.fileForRead, args);
  const { client, bucket, expiresIn } = r2Configuration(true);
  return { url: browserFileUrl(await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }), { expiresIn })) };
} });
export const analyze = internalAction({ args: { extractionId: v.id("transactionExtractions") }, handler: async (ctx, { extractionId }): Promise<void> => {
  let errorCode = "unavailable";
  try {
    const input = await ctx.runQuery(internal.transactionExtractions.input, { extractionId });
    if (!input) { await ctx.runMutation(internal.transactionExtractions.finish, { extractionId, errorCode: "disabled" }); return; }
    const apiKey = process.env.QWEN_API_KEY?.trim();
    const baseURL = process.env.QWEN_BASE_URL?.trim();
    errorCode = "not_configured";
    if (!apiKey || !baseURL || new URL(baseURL).protocol !== "https:") throw new Error("Missing provider configuration");
    const client = createReceiptClient(apiKey, baseURL);
    const storage = r2Configuration();
    errorCode = "invalid_document";
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: "text", text: `Moneda del bolsillo (no asumir que coincide con el documento): ${input.currency}. Tags existentes: ${JSON.stringify(input.tags)}. Archivos del mismo comprobante:` }];
    const pages: number[] = [];
    let pdfPages = 0;
    for (const [index, file] of input.files.entries()) {
      const { bytes } = await verifiedR2File(storage.client, storage.bucket, file);
      content.push({ type: "text", text: `Archivo ${index + 1}: ${JSON.stringify(file.originalName)}` });
      if (file.mimeType === "text/plain") {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.length > 40000 || !text.trim()) throw new Error("Text too large or empty");
        content.push({ type: "text", text: `Página 1 — documento no confiable:\n${text}` }); pages.push(1);
      } else {
        const images = file.mimeType === "application/pdf"
          ? (await renderReceiptPdf(bytes, 10 - pdfPages)).map(bytes => ({ bytes, mimeType: "image/jpeg" }))
          : [await prepareReceiptImage(bytes)];
        if (file.mimeType === "application/pdf") pdfPages += images.length;
        pages.push(images.length);
        for (const [page, image] of images.entries()) {
          content.push({ type: "text", text: `Archivo ${index + 1}, página ${page + 1}` }, { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}` } });
        }
      }
    }
    const dispatched = await ctx.runMutation(internal.transactionExtractions.dispatch, { extractionId });
    if (!dispatched) { await ctx.runMutation(internal.transactionExtractions.finish, { extractionId, errorCode: "disabled" }); return; }
    errorCode = "unavailable";
    const response = await requestReceipt(client, content);
    errorCode = "invalid_response";
    const choice = response.choices[0];
    let raw: unknown = null;
    if (choice?.finish_reason === "stop" && choice.message.content) { try { raw = JSON.parse(choice.message.content); } catch { /* Preserve usage for malformed output too. */ } }
    const parsed = parseExtractionResponse(raw);
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const inRate = Number(process.env.QWEN_INPUT_USD_PER_MILLION);
    const outRate = Number(process.env.QWEN_OUTPUT_USD_PER_MILLION);
    const costUsd = response.usage && Number.isFinite(inRate) && inRate >= 0 && Number.isFinite(outRate) && outRate >= 0 ? (inputTokens * inRate + outputTokens * outRate) / 1e6 : undefined;
    await ctx.runMutation(internal.transactionExtractions.finish, { extractionId, ...(parsed.success ? { result: normalizeExtraction(parsed.data, input.currency, input.tags, pages), pages } : { errorCode }), inputTokens, outputTokens, costUsd });
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError) errorCode = "timeout";
    // Store stable codes only: provider messages may contain document content,
    // request bodies, signed URLs or credentials.
    await ctx.runMutation(internal.transactionExtractions.finish, { extractionId, errorCode });
  }
} });
