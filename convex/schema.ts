import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const currencyValidator = v.union(v.literal("CRC"), v.literal("USD"));
export const transactionTypeValidator = v.union(
  v.literal("income"),
  v.literal("expense"),
);

export default defineSchema({
  wallets: defineTable({
    ownerId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    currency: currencyValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_archived", ["ownerId", "archivedAt"]),

  transactions: defineTable({
    ownerId: v.string(),
    walletId: v.id("wallets"),
    type: transactionTypeValidator,
    amountMinor: v.number(),
    description: v.string(),
    date: v.string(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_wallet", ["walletId"])
    .index("by_wallet_date", ["walletId", "date"])
    .index("by_wallet_created", ["walletId", "createdAt"]),
});
