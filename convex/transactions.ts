import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { boundedGroup, buildTrend, periodTotals, previousRange, rangeDays, rangeError, tagBreakdown } from "../lib/statistics";

import { mutation, query } from "./_generated/server";
import { featureAccess, requireAccountContext, requireFeature } from "./auth";
import { requireOwnedWallet } from "./domain";
import { validateAssignedTagIds } from "./tags";
import { transactionFields, validatedTransactionFields, transactionPreconditions, requireTransactionPreconditions } from "./transactionDomain";
import { transactionTypeValidator } from "./schema";
import { deleteMovementDrafts } from "./transactionDrafts";
import { deleteTransactionFiles, publicTransactionFiles } from "./transactionFiles";

function hideFileCount<T extends { fileCount?: number; fileRevision?: number; receiptFileIds?: unknown }>(transaction: T) {
  const visibleTransaction = { ...transaction };
  delete visibleTransaction.fileCount;
  delete visibleTransaction.fileRevision;
  delete visibleTransaction.receiptFileIds;
  return visibleTransaction;
}

const statisticsRangeFields = { walletId: v.id("wallets"), start: v.string(), end: v.string() };

export const getWalletStatistics = query({
  args: { ...statisticsRangeFields, group: v.union(v.literal("day"), v.literal("week"), v.literal("month")) },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    const wallet = await requireOwnedWallet(ctx, args.walletId, ownerId, account._id);
    const error = rangeError(args);
    if (error) throw new ConvexError({ code: "VALIDATION_ERROR", message: error });
    const previous = previousRange(args);
    const [transactions, tags, first] = await Promise.all([
      ctx.db.query("transactions").withIndex("by_wallet_date", q =>
        q.eq("walletId", args.walletId).gte("date", previous.start).lte("date", args.end),
      ).collect(),
      ctx.db.query("tags").withIndex("by_wallet", q => q.eq("walletId", args.walletId)).collect(),
      ctx.db.query("transactions").withIndex("by_wallet_date", q => q.eq("walletId", args.walletId)).first(),
    ]);
    const current = transactions.filter(transaction => transaction.date >= args.start);
    const earlier = transactions.filter(transaction => transaction.date < args.start);
    const days = rangeDays(args);
    const group = boundedGroup(args, args.group);
    return {
      wallet: { _id: wallet._id, name: wallet.name, currency: wallet.currency, archivedAt: wallet.archivedAt },
      range: { start: args.start, end: args.end },
      days,
      group,
      current: periodTotals(current, days),
      previous: { ...periodTotals(earlier, days), ...previous },
      firstDate: first?.date ?? null,
      comparisonAvailable: Boolean(first && first.date <= previous.start),
      trend: buildTrend(current, args, group),
      breakdown: {
        income: tagBreakdown(current, tags.map(tag => tag._id), "income"),
        expense: tagBreakdown(current, tags.map(tag => tag._id), "expense"),
      },
      tags: tags.map(tag => ({
        _id: tag._id, walletId: tag.walletId, label: tag.label, color: tag.color,
        description: tag.description, createdAt: tag.createdAt, updatedAt: tag.updatedAt,
        usageCount: current.filter(transaction => transaction.tagIds?.includes(tag._id)).length,
      })),
    };
  },
});

export const listStatisticsTransactions = query({
  args: {
    ...statisticsRangeFields,
    type: v.optional(transactionTypeValidator),
    tagId: v.optional(v.union(v.id("tags"), v.null())),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, args.walletId, ownerId, account._id);
    const error = rangeError(args);
    if (error) throw new ConvexError({ code: "VALIDATION_ERROR", message: error });
    if (args.tagId) {
      const tag = await ctx.db.get(args.tagId);
      if (!tag || tag.walletId !== args.walletId) {
        throw new ConvexError({ code: "INVALID_TRANSACTION_TAG", message: "Este tag no pertenece al bolsillo." });
      }
    }
    let selection = ctx.db.query("transactions").withIndex("by_wallet_date", q =>
      q.eq("walletId", args.walletId).gte("date", args.start).lte("date", args.end),
    ).order("desc");
    if (args.type) selection = selection.filter(q => q.eq(q.field("type"), args.type));
    if (args.tagId === null) {
      selection = selection.filter(q => q.or(q.eq(q.field("tagIds"), undefined), q.eq(q.field("tagIds"), [])));
    } else if (args.tagId) {
      selection = selection.filter(q => q.neq(q.field("tagIds"), undefined));
    }
    const page = await selection.paginate(args.paginationOpts);
    // Convex's filter expressions have no array-includes operator. Keep the cursor
    // from the indexed page, even when a tag matches no items in that page.
    return {
      ...page,
      page: page.page.filter(transaction => !args.tagId || transaction.tagIds?.includes(args.tagId)).map(hideFileCount),
    };
  },
});

export const listTransactionsByWallet = query({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    const [transactions, filesFeature] = await Promise.all([
      ctx.db
      .query("transactions")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect(),
      featureAccess(ctx, account._id, "transactions.files"),
    ]);
    const sorted = transactions.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
    );
    return filesFeature.enabled ? sorted : sorted.map(hideFileCount);
  },
});

export const getTransaction = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new ConvexError({ code: "TRANSACTION_NOT_FOUND", message: "No encontramos este movimiento." });
    }
    await requireOwnedWallet(ctx, transaction.walletId, ownerId, account._id);
    const filesFeature = await featureAccess(ctx, account._id, "transactions.files");
    if (!filesFeature.enabled) return hideFileCount(transaction);
    return {
      ...transaction,
      files: await publicTransactionFiles(ctx, transaction._id),
    };
  },
});

export const createTransaction = mutation({
  args: { walletId: v.id("wallets"), ...transactionFields },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    const wallet = await requireOwnedWallet(ctx, args.walletId, ownerId, account._id);
    if (wallet.archivedAt) {
      throw new ConvexError({ code: "WALLET_ARCHIVED", message: "Restaurá el bolsillo para agregar movimientos." });
    }
    const now = Date.now();
    const tagIds = await validateAssignedTagIds(ctx, args.tagIds, args.walletId, ownerId);
    return await ctx.db.insert("transactions", {
      ownerId,
      walletId: args.walletId,
      ...validatedTransactionFields(args),
      tagIds,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTransaction = mutation({
  args: { transactionId: v.id("transactions"), ...transactionPreconditions, ...transactionFields },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new ConvexError({ code: "TRANSACTION_NOT_FOUND", message: "No encontramos este movimiento." });
    }
    const wallet = await requireOwnedWallet(ctx, transaction.walletId, ownerId, account._id);
    if (wallet.archivedAt) {
      throw new ConvexError({ code: "WALLET_ARCHIVED", message: "Restaurá el bolsillo para editar movimientos." });
    }
    const tagIds = await validateAssignedTagIds(ctx, args.tagIds, transaction.walletId, ownerId);
    requireTransactionPreconditions(transaction, wallet, args);
    await ctx.db.patch(args.transactionId, { ...validatedTransactionFields(args), tagIds, revision: (transaction.revision ?? 0) + 1, updatedAt: Date.now() });
  },
});

export const deleteTransaction = mutation({
  args: { transactionId: v.id("transactions"), expectedRevision: v.optional(v.number()) },
  handler: async (ctx, { transactionId, expectedRevision }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new ConvexError({ code: "TRANSACTION_NOT_FOUND", message: "No encontramos este movimiento." });
    }
    const wallet = await requireOwnedWallet(ctx, transaction.walletId, ownerId, account._id);
    if (wallet.archivedAt) throw new ConvexError({ code: "WALLET_ARCHIVED", message: "Restaurá el bolsillo para eliminar movimientos." });
    if (expectedRevision !== undefined && (transaction.revision ?? 0) !== expectedRevision) throw new ConvexError({ code: "TRANSACTION_CONFLICT", message: "El movimiento cambió en otra sesión. Revisá sus datos antes de eliminarlo." });
    await deleteMovementDrafts(ctx, transaction._id);
    await deleteTransactionFiles(ctx, transaction._id, account._id);
    await ctx.db.delete(transactionId);
  },
});
