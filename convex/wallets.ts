import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAccountContext, requireFeature } from "./auth";
import { optionalText, requireOwnedWallet, requireText } from "./domain";
import { currencyValidator } from "./schema";
import { deleteTransactionFiles } from "./transactionFiles";

async function walletSummary(
  ctx: Parameters<typeof requireOwnedWallet>[0],
  wallet: Doc<"wallets">,
) {
  const transactions = await ctx.db
    .query("transactions")
    .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
    .collect();

  let totalIncome = 0;
  let totalExpense = 0;
  let latestMovementAt: string | undefined;

  for (const transaction of transactions) {
    if (transaction.type === "income") totalIncome += transaction.amountMinor;
    else totalExpense += transaction.amountMinor;
    if (!latestMovementAt || transaction.date > latestMovementAt) latestMovementAt = transaction.date;
  }

  return {
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    latestMovementAt,
    transactionCount: transactions.length,
  };
}

export const listActiveWallets = query({
  args: {},
  handler: async (ctx) => {
    const { account } = await requireAccountContext(ctx);
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();
    const summarized = await Promise.all(
      wallets.map(async (wallet) => ({ ...wallet, ...(await walletSummary(ctx, wallet)) })),
    );
    return summarized.sort(
      (a, b) =>
        (b.latestMovementAt ? Date.parse(b.latestMovementAt) : b.createdAt) -
        (a.latestMovementAt ? Date.parse(a.latestMovementAt) : a.createdAt),
    );
  },
});

export const listArchivedWallets = query({
  args: {},
  handler: async (ctx) => {
    const { account } = await requireAccountContext(ctx);
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .filter((q) => q.neq(q.field("archivedAt"), undefined))
      .collect();
    return await Promise.all(
      wallets
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
        .map(async (wallet) => ({ ...wallet, ...(await walletSummary(ctx, wallet)) })),
    );
  },
});

export const getWallet = query({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    const wallet = await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    return { ...wallet, ...(await walletSummary(ctx, wallet)) };
  },
});

export const createWallet = mutation({
  args: { name: v.string(), description: v.optional(v.string()), currency: currencyValidator },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    const feature = await requireFeature(ctx, account._id, "wallets.create");
    if (feature?.limit !== undefined) {
      const activeWallets = await ctx.db
        .query("wallets")
        .withIndex("by_account_archived", (q) =>
          q.eq("accountId", account._id).eq("archivedAt", undefined),
        )
        .collect();
      if (activeWallets.length >= feature.limit) {
        throw new ConvexError({
          code: "FEATURE_LIMIT_REACHED",
          message: `Tu cuenta puede tener hasta ${feature.limit} bolsillos activos.`,
        });
      }
    }
    const now = Date.now();
    return await ctx.db.insert("wallets", {
      ownerId,
      accountId: account._id,
      name: requireText(args.name, "El nombre", 60),
      description: optionalText(args.description, 240),
      currency: args.currency,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateWallet = mutation({
  args: {
    walletId: v.id("wallets"),
    name: v.string(),
    description: v.optional(v.string()),
    currency: currencyValidator,
  },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, args.walletId, ownerId, account._id);
    await ctx.db.patch(args.walletId, {
      name: requireText(args.name, "El nombre", 60),
      description: optionalText(args.description, 240),
      currency: args.currency,
      updatedAt: Date.now(),
    });
  },
});

export const archiveWallet = mutation({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    const now = Date.now();
    await ctx.db.patch(walletId, { archivedAt: now, updatedAt: now });
  },
});

export const restoreWallet = mutation({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    const feature = await requireFeature(ctx, account._id, "wallets.create");
    if (feature?.limit !== undefined) {
      const activeWallets = await ctx.db
        .query("wallets")
        .withIndex("by_account_archived", (q) =>
          q.eq("accountId", account._id).eq("archivedAt", undefined),
        )
        .collect();
      if (activeWallets.length >= feature.limit) {
        throw new ConvexError({
          code: "FEATURE_LIMIT_REACHED",
          message: `Tu cuenta puede tener hasta ${feature.limit} bolsillos activos.`,
        });
      }
    }
    await ctx.db.patch(walletId, { archivedAt: undefined, updatedAt: Date.now() });
  },
});

export const deleteWallet = mutation({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId, account._id);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect();
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect();
    await Promise.all(transactions.map(async (transaction) => {
      await deleteTransactionFiles(ctx, transaction._id, account._id);
      await ctx.db.delete(transaction._id);
    }));
    await Promise.all(tags.map((tag) => ctx.db.delete(tag._id)));
    await ctx.db.delete(walletId);
  },
});
