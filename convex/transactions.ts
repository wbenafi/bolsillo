import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

import { internalQuery, mutation, query } from "./_generated/server";
import { featureAccess, requireAccountContext, requireFeature } from "./auth";
import { requireOwnedWallet } from "./domain";
import { validateAssignedTagIds } from "./tags";
import { currentTransaction, moneyVersionFields, requireMoneyVersion, transactionFields, validatedTransactionFields } from "./transactionDomain";
import { deleteMovementDrafts } from "./transactionDrafts";
import { deleteTransactionFiles, publicTransactionFiles } from "./transactionFiles";

/** Read-only deployment preflight. No monetary values or records are patched. */
export const auditMoneyCompatibility = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("transactions").paginate({ ...paginationOpts, numItems: Math.min(100, paginationOpts.numItems) });
    const issues: Array<{ transactionId: string; reason: string }> = [];
    let legacyCRC = 0;
    let legacyUSD = 0;
    let versioned = 0;
    for (const transaction of page.page) {
      const wallet = await ctx.db.get(transaction.walletId);
      if (!wallet) {
        issues.push({ transactionId: transaction._id, reason: "Bolsillo inexistente." });
        continue;
      }
      if (transaction.moneyVersion === 2) versioned++;
      else if (wallet.currency === "CRC") legacyCRC++;
      else legacyUSD++;
      try {
        currentTransaction(transaction, wallet.currency);
      } catch {
        issues.push({ transactionId: transaction._id, reason: "Monto inválido o fuera de la precisión soportada." });
      }
    }
    return { scanned: page.page.length, legacyCRC, legacyUSD, versioned, issues, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

function hideFileCount<T extends { fileCount?: number; fileRevision?: number }>(transaction: T) {
  const visibleTransaction = { ...transaction };
  delete visibleTransaction.fileCount;
  delete visibleTransaction.fileRevision;
  return visibleTransaction;
}

export const listTransactionsByWallet = query({
  args: { walletId: v.id("wallets"), ...moneyVersionFields },
  handler: async (ctx, { walletId, moneyVersion }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    const wallet = await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    requireMoneyVersion(moneyVersion);
    const [transactions, filesFeature] = await Promise.all([
      ctx.db
      .query("transactions")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect(),
      featureAccess(ctx, account._id, "transactions.files"),
    ]);
    const sorted = transactions.map(t => currentTransaction(t, wallet.currency)).sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
    );
    return filesFeature.enabled ? sorted : sorted.map(hideFileCount);
  },
});

export const getTransaction = query({
  args: { transactionId: v.id("transactions"), ...moneyVersionFields },
  handler: async (ctx, { transactionId, moneyVersion }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    const transaction = await ctx.db.get(transactionId);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new ConvexError({ code: "TRANSACTION_NOT_FOUND", message: "No encontramos este movimiento." });
    }
    const wallet = await requireOwnedWallet(ctx, transaction.walletId, ownerId, account._id);
    requireMoneyVersion(moneyVersion);
    const current = currentTransaction(transaction, wallet.currency);
    const filesFeature = await featureAccess(ctx, account._id, "transactions.files");
    if (!filesFeature.enabled) return hideFileCount(current);
    return {
      ...current,
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
    await ctx.db.patch(args.transactionId, { ...validatedTransactionFields(args), tagIds, revision: (transaction.revision ?? 0) + 1, updatedAt: Date.now() });
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
    await deleteMovementDrafts(ctx, transaction._id);
    await deleteTransactionFiles(ctx, transaction._id, account._id);
    await ctx.db.delete(transactionId);
  },
});
