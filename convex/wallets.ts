import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOwnerId } from "./auth";
import { optionalText, requireOwnedWallet, requireText } from "./domain";
import { currencyValidator } from "./schema";

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
    const ownerId = await requireOwnerId(ctx);
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
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
    const ownerId = await requireOwnerId(ctx);
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
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
    const ownerId = await requireOwnerId(ctx);
    const wallet = await requireOwnedWallet(ctx, walletId, ownerId);
    return { ...wallet, ...(await walletSummary(ctx, wallet)) };
  },
});

export const createWallet = mutation({
  args: { name: v.string(), description: v.optional(v.string()), currency: currencyValidator },
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const now = Date.now();
    return await ctx.db.insert("wallets", {
      ownerId,
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
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedWallet(ctx, args.walletId, ownerId);
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
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId);
    const now = Date.now();
    await ctx.db.patch(walletId, { archivedAt: now, updatedAt: now });
  },
});

export const restoreWallet = mutation({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId);
    await ctx.db.patch(walletId, { archivedAt: undefined, updatedAt: Date.now() });
  },
});

export const deleteWallet = mutation({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect();
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_wallet", (q) => q.eq("walletId", walletId))
      .collect();
    await Promise.all(transactions.map((transaction) => ctx.db.delete(transaction._id)));
    await Promise.all(tags.map((tag) => ctx.db.delete(tag._id)));
    await ctx.db.delete(walletId);
  },
});
