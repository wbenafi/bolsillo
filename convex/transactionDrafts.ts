import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, internalQuery, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAccountContext, requireFeature, requireCurrentUser } from "./auth";
import { requireOwnedWallet } from "./domain";
import { currencyValidator, transactionFileTypeValidator, transactionTypeValidator } from "./schema";
import type { ExtractionResult } from "../lib/transaction-extraction";
import { parseMoneyInput } from "../lib/money";
import { publicFile, queueObjectDeletions, validatedDisplayName, validatedOriginalName, validatedSize } from "./transactionFiles";
import { transactionFields, validatedTransactionFields } from "./transactionDomain";
import { validateAssignedTagIds } from "./tags";

export const DRAFT_TTL = 24 * 60 * 60 * 1000;
export const draftValues = v.object({ type: transactionTypeValidator, amount: v.string(), description: v.string(), date: v.string(), notes: v.string(), tagIds: v.array(v.id("tags")) });
const modeValidator = v.union(v.literal("manual"), v.literal("documents"));
export function draftError(message = "Este borrador ya no está disponible."): never { throw new ConvexError({ code: "DRAFT_ERROR", message }); }
export async function ownedDraft(ctx: QueryCtx | MutationCtx, id: Id<"transactionDrafts">, allowSaved = false) {
  const auth = await requireAccountContext(ctx);
  await requireFeature(ctx, auth.account._id, "transactions.manage");
  const draft = await ctx.db.get(id);
  if (!draft || draft.userId !== auth.user._id || draft.accountId !== auth.account._id || draft.expiresAt <= Date.now() || (draft.status !== "active" && !(allowSaved && draft.status === "saved"))) draftError();
  const wallet = await requireOwnedWallet(ctx, draft.walletId, auth.ownerId, auth.account._id);
  if (wallet.archivedAt) draftError("Restaurá el bolsillo para continuar.");
  return { ...auth, draft, wallet };
}
export async function checkedDraftFiles(ctx: QueryCtx | MutationCtx, draft: Doc<"transactionDrafts">, ids = draft.fileIds) {
  if (ids.length > 5 || new Set(ids).size !== ids.length) draftError("Podés adjuntar hasta 5 archivos.");
  const files: Doc<"transactionFiles">[] = [];
  for (const id of ids) {
    const file = await ctx.db.get(id);
    if (!file || file.accountId !== draft.accountId || file.walletId !== draft.walletId) draftError("Uno de los archivos ya no está disponible.");
    if (file.status === "ready") {
      if (!draft.transactionId || file.transactionId !== draft.transactionId) draftError();
    } else {
      const batch = await ctx.db.get(file.uploadBatchId);
      if (!batch || batch.draftId !== draft._id || batch.status !== "pending" || batch.expiresAt <= Date.now() || !file.etag) draftError("Esperá a que terminen de subir los archivos.");
    }
    files.push(file);
  }
  return files;
}
export async function cancelDraftAnalysis(ctx: MutationCtx, draft: Doc<"transactionDrafts">) {
  if (!draft.extractionId) return;
  const job = await ctx.db.get(draft.extractionId);
  if (!job || !["queued", "processing"].includes(job.status)) return;
  await ctx.db.patch(job._id, { status: "cancelled", finishedAt: Date.now() });
  if (!job.dispatched) {
    const usage = await ctx.db.query("aiMonthlyUsage").withIndex("by_account_month", q => q.eq("accountId", job.accountId).eq("month", job.month)).unique();
    if (usage) await ctx.db.patch(usage._id, { reserved: Math.max(0, usage.reserved - 1) });
  }
}
export const setPreferredMode = mutation({
  args: { mode: modeValidator }, handler: async (ctx, { mode }) => {
    const { user } = await requireCurrentUser(ctx);
    await ctx.db.patch(user._id, { newTransactionMode: mode, updatedAt: Date.now() });
  },
});
export const create = mutation({
  args: { walletId: v.id("wallets"), transactionId: v.optional(v.id("transactions")), expectedRevision: v.optional(v.number()), expectedFileRevision: v.optional(v.number()), clientKey: v.string(), values: draftValues, mode: modeValidator },
  handler: async (ctx, args) => {
    const { account, user, ownerId } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    if (args.transactionId) draftError("Las ediciones no crean borradores. Recargá el movimiento para editarlo y guardar los cambios directamente.");
    const wallet = await requireOwnedWallet(ctx, args.walletId, ownerId, account._id);
    if (wallet.archivedAt || !args.clientKey.trim() || args.clientKey.length > 100) draftError();
    const existing = await ctx.db.query("transactionDrafts").withIndex("by_user_key", q => q.eq("userId", user._id).eq("clientKey", args.clientKey)).order("desc").first();
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.walletId !== args.walletId || existing.transactionId !== args.transactionId || existing.status !== "active") draftError();
      return existing._id;
    }
    const active = await ctx.db.query("transactionDrafts").withIndex("by_user_wallet_status", q => q.eq("userId", user._id).eq("walletId", args.walletId).eq("status", "active")).filter(q => q.gt(q.field("expiresAt"), Date.now())).take(20);
    if (active.length >= 20) draftError("Tenés varios borradores pendientes. Retomá o descartá uno antes de continuar.");
    validateValues(args.values);
    const now = Date.now();
    const id = await ctx.db.insert("transactionDrafts", { accountId: account._id, userId: user._id, walletId: wallet._id, baseRevision: 0, baseFileRevision: 0, clientKey: args.clientKey, currency: wallet.currency, version: 0, mode: args.mode, values: args.values, fileIds: [], selectedFileIds: [], reviewedFields: [], status: "active", createdAt: now, updatedAt: now, expiresAt: now + DRAFT_TTL });
    await ctx.scheduler.runAfter(DRAFT_TTL, internal.transactionDrafts.expire, { draftId: id });
    return id;
  },
});
function validateValues(values: { amount: string; description: string; date: string; notes: string; tagIds: unknown[] }) {
  if (values.amount.length > 30 || values.description.length > 100 || values.date.length > 10 || values.notes.length > 500 || values.tagIds.length > 50) draftError("Revisá los datos del movimiento.");
}
export const update = mutation({
  args: { draftId: v.id("transactionDrafts"), version: v.number(), values: draftValues, mode: modeValidator, fileIds: v.array(v.id("transactionFiles")), selectedFileIds: v.array(v.id("transactionFiles")), fileNames: v.optional(v.array(v.object({ fileId: v.id("transactionFiles"), displayName: v.optional(v.string()) }))), reviewedFields: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { draft, account } = await ownedDraft(ctx, args.draftId);
    if (draft.version !== args.version) draftError("Este borrador cambió en otra pestaña. Recargá para retomar la versión guardada.");
    validateValues(args.values);
    if (args.reviewedFields.length > 6 || args.reviewedFields.some(f => !["type", "amount", "description", "date", "notes", "tags"].includes(f))) draftError();
    const files = await checkedDraftFiles(ctx, draft, args.fileIds);
    if (args.fileNames && (args.fileNames.length > 5 || new Set(args.fileNames.map(file => file.fileId)).size !== args.fileNames.length || args.fileNames.some(file => !args.fileIds.includes(file.fileId)))) draftError();
    const fileNames = args.fileNames?.map(file => ({ fileId: file.fileId, displayName: validatedDisplayName(file.displayName) })) ?? draft.fileNames?.filter(file => args.fileIds.includes(file.fileId));
    const namesChanged = fileNames?.some(file => {
      const previous = draft.fileNames?.find(item => item.fileId === file.fileId) ?? files.find(item => item._id === file.fileId);
      return file.displayName !== previous?.displayName;
    });
    if (new Set(args.selectedFileIds).size !== args.selectedFileIds.length || args.selectedFileIds.some(id => !args.fileIds.includes(id))) draftError();
    const filesChanged = JSON.stringify(draft.fileIds) !== JSON.stringify(args.fileIds);
    if (filesChanged || namesChanged) await requireFeature(ctx, account._id, "transactions.files");
    // Backing documents are independent of the files explicitly selected for AI.
    const sourceChanged = JSON.stringify(draft.selectedFileIds) !== JSON.stringify(args.selectedFileIds);
    if (sourceChanged || (args.mode === "manual" && draft.mode !== args.mode)) await cancelDraftAnalysis(ctx, draft);
    await ctx.db.patch(draft._id, { values: args.values, mode: args.mode, fileIds: args.fileIds, fileNames, selectedFileIds: args.selectedFileIds, reviewedFields: sourceChanged ? [] : args.reviewedFields, extractionId: sourceChanged ? undefined : draft.extractionId, version: draft.version + 1, updatedAt: Date.now() });
    return draft.version + 1;
  },
});
export const get = query({ args: { draftId: v.id("transactionDrafts") }, handler: async (ctx, { draftId }) => {
  const stored = await ctx.db.get(draftId);
  if (!stored || stored.expiresAt <= Date.now()) { await requireAccountContext(ctx); return null; }
  const { draft } = await ownedDraft(ctx, draftId, true);
  const files = await Promise.all(draft.fileIds.map(id => ctx.db.get(id)));
  const extraction = draft.extractionId ? await ctx.db.get(draft.extractionId) : null;
  return { ...draft, files: files.filter((f): f is Doc<"transactionFiles"> => !!f).map(file => {
    const name = draft.fileNames?.find(item => item.fileId === file._id);
    return { ...publicFile(file), ...(name ? { displayName: name.displayName } : {}) };
  }), extraction: extraction ? { _id: extraction._id, fileIds: extraction.fileIds, status: extraction.status, result: extraction.result, errorCode: extraction.errorCode } : null };
} });
export const list = query({ args: { walletId: v.id("wallets") }, handler: async (ctx, { walletId }) => {
  const { user, ownerId, account } = await requireAccountContext(ctx);
  await requireOwnedWallet(ctx, walletId, ownerId, account._id);
  return (await ctx.db.query("transactionDrafts").withIndex("by_user_wallet_status", q => q.eq("userId", user._id).eq("walletId", walletId).eq("status", "active")).filter(q => q.gt(q.field("expiresAt"), Date.now())).take(20)).map(d => ({ _id: d._id, transactionId: d.transactionId, type: d.values.type, amount: d.values.amount, description: d.values.description, files: d.fileIds.length, expiresAt: d.expiresAt }));
} });
export const beginFiles = mutation({
  args: { draftId: v.id("transactionDrafts"), files: v.array(v.object({ originalName: v.string(), mimeType: transactionFileTypeValidator, sizeBytes: v.number() })) },
  handler: async (ctx, { draftId, files }) => {
    const { draft, account, user } = await ownedDraft(ctx, draftId);
    await requireFeature(ctx, account._id, "transactions.files");
    if (!files.length || draft.fileIds.length + files.length > 5) draftError("Podés adjuntar hasta 5 archivos.");
    const now = Date.now();
    const batchId = await ctx.db.insert("fileUploadBatches", { accountId: account._id, walletId: draft.walletId, draftId, createdByUserId: user._id, status: "pending", createdAt: now, updatedAt: now, expiresAt: draft.expiresAt });
    const fileIds: Id<"transactionFiles">[] = [];
    for (const [order, file] of files.entries()) {
      const id = await ctx.db.insert("transactionFiles", { accountId: account._id, walletId: draft.walletId, uploadBatchId: batchId, createdByUserId: user._id, objectKey: "pending", originalName: validatedOriginalName(file.originalName, file.mimeType), mimeType: file.mimeType, sizeBytes: validatedSize(file.sizeBytes), order, status: "pending", createdAt: now, updatedAt: now, expiresAt: draft.expiresAt });
      await ctx.db.patch(id, { objectKey: `accounts/${account._id}/transaction-files/${id}` }); fileIds.push(id);
    }
    await ctx.scheduler.runAfter(Math.max(0, draft.expiresAt - now), internal.r2.cleanupExpiredBatch, { batchId });
    return { batchId, fileIds };
  },
});
export const verifiedFiles = internalMutation({
  args: { draftId: v.id("transactionDrafts"), batchId: v.id("fileUploadBatches"), files: v.array(v.object({ fileId: v.id("transactionFiles"), etag: v.string() })) },
  handler: async (ctx, { draftId, batchId, files }) => {
    const { account } = await ownedDraft(ctx, draftId);
    await requireFeature(ctx, account._id, "transactions.files");
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.draftId !== draftId || batch.status !== "pending") draftError();
    const batchFiles = await ctx.db.query("transactionFiles").withIndex("by_batch", q => q.eq("uploadBatchId", batchId)).collect();
    if (files.length !== batchFiles.length || new Set(files.map(f => f.fileId)).size !== files.length || files.some(f => !batchFiles.some(b => b._id === f.fileId))) draftError();
    for (const f of files) await ctx.db.patch(f.fileId, { etag: f.etag });
    return files.map(f => f.fileId);
  },
});
export const fileForRead = internalQuery({ args: { draftId: v.id("transactionDrafts"), fileId: v.id("transactionFiles") }, handler: async (ctx, { draftId, fileId }) => {
  const { draft, account } = await ownedDraft(ctx, draftId);
  await requireFeature(ctx, account._id, "transactions.files");
  // Verified new uploads may be previewed while their draft autosave is in flight.
  // checkedDraftFiles still requires this draft’s batch or its owned movement.
  return (await checkedDraftFiles(ctx, draft, [fileId]))[0];
} });
export const save = mutation({ args: { draftId: v.id("transactionDrafts"), version: v.number(), currency: v.optional(currencyValidator), ...transactionFields }, handler: async (ctx, args) => {
  const { draft, ownerId, account, wallet } = await ownedDraft(ctx, args.draftId, true);
  if (draft.status === "saved" && draft.savedTransactionId) return draft.savedTransactionId;
  if (draft.version !== args.version) draftError("El borrador cambió. Recargá antes de guardar.");
  if ((draft.currency && draft.currency !== wallet.currency) || (args.currency && args.currency !== wallet.currency)) draftError("La moneda del bolsillo cambió. Revisá el monto en un nuevo borrador antes de registrar.");
  const extraction = draft.extractionId ? await ctx.db.get(draft.extractionId) : null;
  if (extraction && ["queued", "processing"].includes(extraction.status)) draftError("Esperá a que termine la lectura o elegí completar manualmente.");
  const result = extraction?.status === "ready" ? extraction.result as ExtractionResult | undefined : undefined;
  if (result && ["ok", "partial"].includes(result.status) && !draft.reviewedFields.includes("amount")) draftError("Revisá el monto del comprobante y confirmalo antes de registrar.");
  const transaction = draft.transactionId ? await ctx.db.get(draft.transactionId) : null;
  if (draft.transactionId && (!transaction || transaction.ownerId !== ownerId || transaction.walletId !== draft.walletId || (transaction.revision ?? 0) !== draft.baseRevision || (transaction.fileRevision ?? 0) !== draft.baseFileRevision)) draftError("El movimiento cambió en otra sesión. Volvé a abrirlo para revisar los cambios.");
  const currentFiles = transaction ? await ctx.db.query("transactionFiles").withIndex("by_transaction", q => q.eq("transactionId", transaction._id)).collect() : [];
  const filesChanged = draft.fileIds.length !== currentFiles.length || draft.fileIds.some(id => !currentFiles.some(f => f._id === id));
  const namesChanged = draft.fileNames?.some(file => file.displayName !== currentFiles.find(current => current._id === file.fileId)?.displayName);
  if (filesChanged || namesChanged) await requireFeature(ctx, account._id, "transactions.files");
  const files = await checkedDraftFiles(ctx, draft);
  const tagIds = await validateAssignedTagIds(ctx, args.tagIds, draft.walletId, ownerId);
  const fields = validatedTransactionFields(args);
  if (fields.type !== draft.values.type || fields.amountMinor !== parseMoneyInput(draft.values.amount, wallet.currency) || fields.description !== draft.values.description.trim() || fields.date !== draft.values.date || (fields.notes ?? "") !== draft.values.notes.trim() || JSON.stringify(args.tagIds ?? []) !== JSON.stringify(draft.values.tagIds)) draftError("Los datos cambiaron desde la revisión. Guardá el borrador y revisalos antes de registrar.");
  const now = Date.now();
  const receiptFileIds = [...new Set([...(transaction?.receiptFileIds ?? []), ...(result ? extraction!.fileIds : [])])].filter(id => draft.fileIds.includes(id));
  const data = { ...fields, tagIds, receiptFileIds, fileCount: files.length, fileRevision: (transaction?.fileRevision ?? 0) + 1, revision: (transaction?.revision ?? 0) + 1, updatedAt: now };
  const transactionId = transaction?._id ?? await ctx.db.insert("transactions", { ownerId, walletId: draft.walletId, ...data, createdAt: now });
  if (transaction) await ctx.db.patch(transactionId, data);
  const removed = currentFiles.filter(f => !draft.fileIds.includes(f._id));
  await queueObjectDeletions(ctx, account._id, removed.map(f => f.objectKey), "draft_file_removed");
  for (const file of removed) await ctx.db.delete(file._id);
  for (const [order, file] of files.entries()) {
    const name = draft.fileNames?.find(item => item.fileId === file._id);
    await ctx.db.patch(file._id, { transactionId, status: "ready", order, ...(name ? { displayName: name.displayName } : {}), expiresAt: undefined, updatedAt: now });
    if (file.status === "pending") await ctx.db.patch(file.uploadBatchId, { status: "committed", committedTransactionId: transactionId, updatedAt: now });
  }
  // A batch can contain files removed from the draft before saving. Delete those
  // objects now; committed batches are never treated as abandoned uploads.
  for (const batchId of new Set(files.filter(f => f.status === "pending").map(f => f.uploadBatchId))) {
    const leftovers = (await ctx.db.query("transactionFiles").withIndex("by_batch", q => q.eq("uploadBatchId", batchId)).collect()).filter(f => f.status === "pending");
    await queueObjectDeletions(ctx, account._id, leftovers.map(f => f.objectKey), "unused_draft_files");
    for (const file of leftovers) await ctx.db.delete(file._id);
  }
  await cancelDraftAnalysis(ctx, draft);
  await ctx.db.patch(draft._id, { status: "saved", savedTransactionId: transactionId, updatedAt: now });
  return transactionId;
} });
async function dispose(ctx: MutationCtx, draft: Doc<"transactionDrafts">) {
  await cancelDraftAnalysis(ctx, draft);
  const batches = await ctx.db.query("fileUploadBatches").withIndex("by_draft", q => q.eq("draftId", draft._id)).collect();
  for (const batch of batches.filter(b => b.draftId === draft._id && b.status === "pending")) {
    const files = await ctx.db.query("transactionFiles").withIndex("by_batch", q => q.eq("uploadBatchId", batch._id)).collect();
    await queueObjectDeletions(ctx, draft.accountId, files.map(f => f.objectKey), "draft_expired");
    for (const file of files) await ctx.db.delete(file._id);
    await ctx.db.delete(batch._id);
  }
  // Keep operational metrics; remove document-derived content with the draft.
  const jobs = await ctx.db.query("transactionExtractions").withIndex("by_draft", q => q.eq("draftId", draft._id)).collect();
  for (const job of jobs) await ctx.db.patch(job._id, { result: undefined });
  await ctx.db.delete(draft._id);
}
export const discard = mutation({ args: { draftId: v.id("transactionDrafts") }, handler: async (ctx, { draftId }) => { const { draft } = await ownedDraft(ctx, draftId); await dispose(ctx, draft); } });
export const expire = internalMutation({ args: { draftId: v.id("transactionDrafts") }, handler: async (ctx, { draftId }) => { const draft = await ctx.db.get(draftId); if (draft && draft.expiresAt <= Date.now()) await dispose(ctx, draft); } });
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
  const now = Date.now();
  for (const draft of await ctx.db.query("transactionDrafts").withIndex("by_expiration", q => q.lte("expiresAt", now)).take(50)) await dispose(ctx, draft);
  for (const job of await ctx.db.query("transactionExtractions").withIndex("by_expiration", q => q.lte("expiresAt", now)).take(100)) await ctx.db.delete(job._id);
} });

export async function deleteWalletDrafts(ctx: MutationCtx, walletId: Id<"wallets">) {
  for (const draft of await ctx.db.query("transactionDrafts").withIndex("by_wallet", q => q.eq("walletId", walletId)).collect()) await dispose(ctx, draft);
}
export async function deleteMovementDrafts(ctx: MutationCtx, transactionId: Id<"transactions">) {
  for (const draft of await ctx.db.query("transactionDrafts").withIndex("by_transaction", q => q.eq("transactionId", transactionId)).collect()) await dispose(ctx, draft);
}
