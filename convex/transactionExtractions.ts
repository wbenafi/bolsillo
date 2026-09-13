import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAccountContext, requireFeature, requireSuperadmin, featureAccess } from "./auth";
import { ownedDraft, checkedDraftFiles, cancelDraftAnalysis, draftError } from "./transactionDrafts";
import { normalizeExtraction } from "../lib/transaction-extraction";
import { parseMoneyInput } from "../lib/money";

export function monthKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 7); }
async function usageFor(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">, month: string) {
  return ctx.db.query("aiMonthlyUsage").withIndex("by_account_month", q => q.eq("accountId", accountId).eq("month", month)).unique();
}
async function permittedJob(ctx: QueryCtx | MutationCtx, job: Doc<"transactionExtractions">) {
  const [user, account, draft] = await Promise.all([ctx.db.get(job.userId), ctx.db.get(job.accountId), ctx.db.get(job.draftId)]);
  if (!user || user.deletedAt || !account || account.status !== "active" || user.personalAccountId !== account._id || !draft || draft.status !== "active" || draft.expiresAt <= Date.now() || draft.extractionId !== job._id || JSON.stringify(draft.selectedFileIds) !== JSON.stringify(job.fileIds)) return null;
  const wallet = await ctx.db.get(draft.walletId);
  if (!wallet || wallet.archivedAt || wallet.ownerId !== user.externalId || (wallet.accountId && wallet.accountId !== account._id)) return null;
  for (const key of ["transactions.manage", "transactions.files", "transactions.aiExtract"] as const) if (!(await featureAccess(ctx, account._id, key)).enabled) return null;
  if (draft.transactionId) {
    const transaction = await ctx.db.get(draft.transactionId);
    if (!transaction || transaction.walletId !== wallet._id || transaction.ownerId !== user.externalId) return null;
  }
  return { draft, wallet };
}
export const usage = query({ args: {}, handler: async ctx => {
  const { account } = await requireAccountContext(ctx);
  const access = await featureAccess(ctx, account._id, "transactions.aiExtract");
  const usage = await usageFor(ctx, account._id, monthKey());
  return { used: usage?.used ?? 0, reserved: usage?.reserved ?? 0, limit: access.override?.limit ?? 30, month: monthKey() };
} });
export const start = mutation({ args: { draftId: v.id("transactionDrafts"), version: v.number(), reanalyze: v.optional(v.boolean()), requestKey: v.optional(v.string()) }, handler: async (ctx, { draftId, version, reanalyze, requestKey }): Promise<Id<"transactionExtractions">> => {
  const { draft, account } = await ownedDraft(ctx, draftId);
  await requireFeature(ctx, account._id, "transactions.files");
  const override = await requireFeature(ctx, account._id, "transactions.aiExtract");
  if (requestKey && requestKey.length > 100) draftError();
  if (version !== draft.version) draftError("Guardá los cambios del borrador antes de analizar.");
  if (!draft.selectedFileIds.length) draftError("Elegí al menos un archivo para leer.");
  await checkedDraftFiles(ctx, draft, draft.selectedFileIds);
  if (draft.extractionId) {
    const existing = await ctx.db.get(draft.extractionId);
    if (existing && JSON.stringify(existing.fileIds) === JSON.stringify(draft.selectedFileIds) && (["queued", "processing"].includes(existing.status) || (existing.status === "ready" && !reanalyze) || (requestKey && existing.requestKey === requestKey))) return existing._id;
  }
  const month = monthKey();
  let usage = await usageFor(ctx, account._id, month);
  if (!usage) {
    const id = await ctx.db.insert("aiMonthlyUsage", { accountId: account._id, month, used: 0, reserved: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, pricedCalls: 0 });
    usage = (await ctx.db.get(id))!;
  }
  if (usage.used + usage.reserved >= (override?.limit ?? 30)) draftError("Llegaste al límite de lecturas de este mes. Podés completar y guardar el movimiento manualmente.");
  await ctx.db.patch(usage._id, { reserved: usage.reserved + 1 });
  const now = Date.now();
  const id = await ctx.db.insert("transactionExtractions", { accountId: account._id, userId: draft.userId, draftId, fileIds: draft.selectedFileIds, month, requestKey, status: "queued", dispatched: false, createdAt: now, expiresAt: now + 30 * 86400000 });
  await ctx.db.patch(draftId, { extractionId: id, reviewedFields: [], updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.transactionAI.analyze, { extractionId: id });
  await ctx.scheduler.runAfter(60_000, internal.transactionExtractions.timeout, { extractionId: id });
  return id;
} });
export const cancel = mutation({ args: { draftId: v.id("transactionDrafts") }, handler: async (ctx, { draftId }) => { const { draft } = await ownedDraft(ctx, draftId); await cancelDraftAnalysis(ctx, draft); } });
export const input = internalQuery({ args: { extractionId: v.id("transactionExtractions") }, handler: async (ctx, { extractionId }) => {
  const job = await ctx.db.get(extractionId);
  if (!job || job.status !== "queued") return null;
  const permitted = await permittedJob(ctx, job);
  if (!permitted) return null;
  const files = await checkedDraftFiles(ctx, permitted.draft, job.fileIds);
  const tags = await ctx.db.query("tags").withIndex("by_wallet", q => q.eq("walletId", permitted.wallet._id)).collect();
  return { files, currency: permitted.wallet.currency, tags: tags.map(t => t.label) };
} });
export const dispatch = internalMutation({ args: { extractionId: v.id("transactionExtractions") }, handler: async (ctx, { extractionId }) => {
  const job = await ctx.db.get(extractionId);
  if (!job || job.status !== "queued" || !(await permittedJob(ctx, job))) return false;
  const usage = await usageFor(ctx, job.accountId, job.month);
  if (!usage) return false;
  await ctx.db.patch(usage._id, { reserved: Math.max(0, usage.reserved - 1), used: usage.used + 1 });
  await ctx.db.patch(job._id, { dispatched: true, status: "processing" });
  return true;
} });
export const finish = internalMutation({ args: { extractionId: v.id("transactionExtractions"), result: v.optional(v.any()), pages: v.optional(v.array(v.number())), errorCode: v.optional(v.string()), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), costUsd: v.optional(v.number()) }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.extractionId);
  if (!job || job.inputTokens !== undefined) return;
  const usage = await usageFor(ctx, job.accountId, job.month);
  const terminal = job.status === "ready" || job.status === "failed";
  const permitted = terminal ? null : await permittedJob(ctx, job);
  let errorCode = args.errorCode ?? (!permitted ? "disabled" : undefined);
  const cancelled = job.status === "cancelled" || !permitted;
  const inputTokens = Number.isSafeInteger(args.inputTokens) && args.inputTokens! >= 0 ? args.inputTokens! : 0;
  const outputTokens = Number.isSafeInteger(args.outputTokens) && args.outputTokens! >= 0 ? args.outputTokens! : 0;
  const costUsd = args.costUsd !== undefined && Number.isFinite(args.costUsd) && args.costUsd >= 0 ? args.costUsd : undefined;
  let result;
  if (!terminal && !cancelled && !errorCode && args.result && permitted) {
    const tags = await ctx.db.query("tags").withIndex("by_wallet", q => q.eq("walletId", permitted.wallet._id)).collect();
    result = normalizeExtraction(args.result, permitted.wallet.currency, tags.map(t => t.label), args.pages ?? []);
    if (!["ok", "partial"].includes(result.status)) errorCode = result.status;
    if (result.fields.date.value && result.fields.amount.value && !result.currencyMismatch) {
      const amount = parseMoneyInput(result.fields.amount.value, permitted.wallet.currency);
      const date = result.fields.date.value;
      const type = result.fields.type.value;
      const transactions = await ctx.db.query("transactions").withIndex("by_wallet_date", q => q.eq("walletId", permitted.wallet._id).eq("date", date)).collect();
      result.duplicate = transactions.some(t => t._id !== permitted.draft.transactionId && t.amountMinor === amount && (!type || t.type === type));
    }
  } else if (!terminal && !cancelled && !errorCode) errorCode = "invalid_response";
  // A cancelled or timed-out request can still return billable usage. Count it
  // once, without delivering late data or counting a timeout error twice.
  if (usage) await ctx.db.patch(usage._id, {
    reserved: Math.max(0, usage.reserved - (!terminal && !job.dispatched && job.status !== "cancelled" ? 1 : 0)),
    errors: usage.errors + (errorCode && !terminal && !cancelled ? 1 : 0),
    inputTokens: usage.inputTokens + inputTokens, outputTokens: usage.outputTokens + outputTokens,
    costUsd: usage.costUsd + (costUsd ?? 0), pricedCalls: usage.pricedCalls + (costUsd !== undefined ? 1 : 0),
  });
  await ctx.db.patch(job._id, { ...(terminal ? {} : { status: cancelled ? "cancelled" as const : errorCode ? "failed" as const : "ready" as const, result, errorCode, finishedAt: Date.now() }), inputTokens, outputTokens, costUsd });
} });
export const timeout = internalMutation({ args: { extractionId: v.id("transactionExtractions") }, handler: async (ctx, { extractionId }) => {
  const job = await ctx.db.get(extractionId);
  if (!job || !["queued", "processing"].includes(job.status)) return;
  const usage = await usageFor(ctx, job.accountId, job.month);
  if (usage) await ctx.db.patch(usage._id, { reserved: Math.max(0, usage.reserved - (job.dispatched ? 0 : 1)), errors: usage.errors + 1 });
  await ctx.db.patch(job._id, { status: "failed", errorCode: "timeout", finishedAt: Date.now() });
} });
export const adminUsage = query({ args: { accountId: v.id("accounts") }, handler: async (ctx, { accountId }) => {
  await requireSuperadmin(ctx);
  const current = await usageFor(ctx, accountId, monthKey());
  const jobs = await ctx.db.query("transactionExtractions").withIndex("by_account_created", q => q.eq("accountId", accountId)).order("desc").take(30);
  return { month: monthKey(), current, recent: jobs.map(j => ({ _id: j._id, status: j.status, errorCode: j.errorCode, createdAt: j.createdAt, durationMs: j.finishedAt ? j.finishedAt - j.createdAt : undefined, inputTokens: j.inputTokens, outputTokens: j.outputTokens, costUsd: j.costUsd, dispatched: j.dispatched })) };
} });
