import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const currencyValidator = v.union(v.literal("CRC"), v.literal("USD"));
export const transactionTypeValidator = v.union(
  v.literal("income"),
  v.literal("expense"),
);
export const tagColorValidator = v.union(
  v.literal("teal"),
  v.literal("blue"),
  v.literal("violet"),
  v.literal("rose"),
  v.literal("orange"),
  v.literal("amber"),
  v.literal("slate"),
);
export const platformRoleValidator = v.union(
  v.literal("member"),
  v.literal("superadmin"),
);
export const accountStatusValidator = v.union(
  v.literal("active"),
  v.literal("suspended"),
);
export const accountMemberRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
);

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    tokenIdentifier: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    platformRole: platformRoleValidator,
    personalAccountId: v.optional(v.id("accounts")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_platform_role", ["platformRole"]),

  accounts: defineTable({
    name: v.string(),
    kind: v.literal("personal"),
    status: accountStatusValidator,
    primaryOwnerUserId: v.id("users"),
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    suspendedAt: v.optional(v.number()),
    suspendedReason: v.optional(v.string()),
  })
    .index("by_primary_owner", ["primaryOwnerUserId"])
    .index("by_updated", ["updatedAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .searchIndex("search_accounts", {
      searchField: "searchText",
      filterFields: ["status"],
    }),

  accountMembers: defineTable({
    accountId: v.id("accounts"),
    userId: v.id("users"),
    role: accountMemberRoleValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_user", ["userId"])
    .index("by_account_user", ["accountId", "userId"]),

  accountFeatureOverrides: defineTable({
    accountId: v.id("accounts"),
    featureKey: v.string(),
    enabled: v.boolean(),
    limit: v.optional(v.number()),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_feature", ["accountId", "featureKey"]),

  adminAuditLog: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    summary: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_target", ["targetType", "targetId", "createdAt"]),

  wallets: defineTable({
    ownerId: v.string(),
    accountId: v.optional(v.id("accounts")),
    name: v.string(),
    description: v.optional(v.string()),
    currency: currencyValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_archived", ["ownerId", "archivedAt"])
    .index("by_account", ["accountId"])
    .index("by_account_archived", ["accountId", "archivedAt"]),

  transactions: defineTable({
    ownerId: v.string(),
    walletId: v.id("wallets"),
    type: transactionTypeValidator,
    amountMinor: v.number(),
    description: v.string(),
    date: v.string(),
    notes: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_wallet", ["walletId"])
    .index("by_wallet_date", ["walletId", "date"])
    .index("by_wallet_created", ["walletId", "createdAt"]),

  tags: defineTable({
    ownerId: v.string(),
    walletId: v.id("wallets"),
    label: v.string(),
    normalizedLabel: v.string(),
    color: tagColorValidator,
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_wallet", ["walletId"])
    .index("by_wallet_normalized_label", ["walletId", "normalizedLabel"]),
});
