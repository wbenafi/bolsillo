import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAccountContext, requireFeature } from "./auth";
import { optionalText, requireOwnedWallet, requireText } from "./domain";
import { transactionTypeValidator } from "./schema";
import { validateAssignedTagIds } from "./tags";

const transactionFields = {
  type: transactionTypeValidator,
  amountMinor: v.number(),
  description: v.string(),
  date: v.string(),
  notes: v.optional(v.string()),
  tagIds: v.optional(v.array(v.id("tags"))),
};

function validatedFields(args: {
  type: "income" | "expense";
  amountMinor: number;
  description: string;
  date: string;
  notes?: string;
}) {
  if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "El monto debe ser mayor que cero." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(`${args.date}T00:00:00`))) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "La fecha no es válida." });
  }
  return {
    type: args.type,
    amountMinor: args.amountMinor,
    description: requireText(args.description, "La descripción", 100),
    date: args.date,
    notes: optionalText(args.notes, 500),
  };
}

export const listTransactionsByWallet = query({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect();
    return transactions.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
    );
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
    return transaction;
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
      ...validatedFields(args),
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
    await ctx.db.patch(args.transactionId, { ...validatedFields(args), tagIds, updatedAt: Date.now() });
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
    await ctx.db.delete(transactionId);
  },
});
