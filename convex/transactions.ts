import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { featureAccess, requireAccountContext, requireFeature } from "./auth";
import { requireOwnedWallet } from "./domain";
import { validateAssignedTagIds } from "./tags";
import { transactionFields, validatedTransactionFields } from "./transactionDomain";
import { deleteTransactionFiles, publicTransactionFiles } from "./transactionFiles";

function hideFileCount<T extends { fileCount?: number }>(transaction: T) {
  const visibleTransaction = { ...transaction };
  delete visibleTransaction.fileCount;
  return visibleTransaction;
}

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
  args: { transactionId: v.id("transactions"), ...transactionFields },
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
    await ctx.db.patch(args.transactionId, { ...validatedTransactionFields(args), tagIds, updatedAt: Date.now() });
  },
});

export const deleteTransaction = mutation({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new ConvexError({ code: "TRANSACTION_NOT_FOUND", message: "No encontramos este movimiento." });
    }
    await requireOwnedWallet(ctx, transaction.walletId, ownerId, account._id);
    await deleteTransactionFiles(ctx, transaction._id, account._id);
    await ctx.db.delete(transactionId);
  },
});
