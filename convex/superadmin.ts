import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireSuperadmin } from "./auth";
import { accountStatusValidator, platformRoleValidator } from "./schema";
import { upsertUserAndPersonalAccount } from "./users";
import { FEATURE_DEFINITIONS, isFeatureKey, resolveFeatureAccess } from "../lib/features";

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

async function audit(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  action: string,
  targetType: string,
  targetId: string,
  summary: string,
  metadata?: unknown,
) {
  await ctx.db.insert("adminAuditLog", {
    actorUserId,
    action,
    targetType,
    targetId,
    summary,
    metadata,
    createdAt: Date.now(),
  });
}

async function requireAccount(ctx: DatabaseContext, accountId: Id<"accounts">) {
  const account = await ctx.db.get(accountId);
  if (!account) {
    throw new ConvexError({ code: "ACCOUNT_NOT_FOUND", message: "No encontramos esta cuenta." });
  }
  return account;
}

async function accountListItem(ctx: QueryCtx, account: Doc<"accounts">) {
  const [owner, wallets, members, overrides] = await Promise.all([
    ctx.db.get(account.primaryOwnerUserId),
    ctx.db.query("wallets").withIndex("by_account", (q) => q.eq("accountId", account._id)).collect(),
    ctx.db.query("accountMembers").withIndex("by_account", (q) => q.eq("accountId", account._id)).collect(),
    ctx.db
      .query("accountFeatureOverrides")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect(),
  ]);
  return {
    _id: account._id,
    name: account.name,
    status: account.status,
    kind: account.kind,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    suspendedAt: account.suspendedAt,
    suspendedReason: account.suspendedReason,
    owner: owner
      ? {
          _id: owner._id,
          externalId: owner.externalId,
          name: owner.name,
          email: owner.email,
          imageUrl: owner.imageUrl,
          platformRole: owner.platformRole,
          lastSeenAt: owner.lastSeenAt,
          deletedAt: owner.deletedAt,
        }
      : null,
    walletCount: wallets.length,
    activeWalletCount: wallets.filter((wallet) => !wallet.archivedAt).length,
    memberCount: members.length,
    overrideCount: overrides.length,
  };
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const [accounts, users, wallets] = await Promise.all([
      ctx.db.query("accounts").collect(),
      ctx.db.query("users").collect(),
      ctx.db.query("wallets").collect(),
    ]);
    return {
      accountCount: accounts.length,
      activeAccountCount: accounts.filter(({ status }) => status === "active").length,
      suspendedAccountCount: accounts.filter(({ status }) => status === "suspended").length,
      userCount: users.filter((user) => !user.deletedAt).length,
      superadminCount: users.filter(
        (user) => !user.deletedAt && user.platformRole === "superadmin",
      ).length,
      walletCount: wallets.length,
      legacyWalletCount: wallets.filter((wallet) => !wallet.accountId).length,
    };
  },
});

export const listAccounts = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(accountStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireSuperadmin(ctx);
    const search = args.search?.trim().toLocaleLowerCase("es");
    const result = search
      ? await ctx.db
          .query("accounts")
          .withSearchIndex("search_accounts", (q) => {
            const searched = q.search("searchText", search);
            return args.status ? searched.eq("status", args.status) : searched;
          })
          .paginate(args.paginationOpts)
      : args.status
        ? await ctx.db
            .query("accounts")
            .withIndex("by_status_updated", (q) => q.eq("status", args.status!))
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("accounts")
            .withIndex("by_updated")
            .order("desc")
            .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map((account) => accountListItem(ctx, account))),
    };
  },
});

export const getAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireSuperadmin(ctx);
    const account = await requireAccount(ctx, accountId);
    const [owner, memberships, wallets, overrides, recentAudit] = await Promise.all([
      ctx.db.get(account.primaryOwnerUserId),
      ctx.db.query("accountMembers").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
      ctx.db.query("wallets").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
      ctx.db
        .query("accountFeatureOverrides")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect(),
      ctx.db
        .query("adminAuditLog")
        .withIndex("by_target", (q) => q.eq("targetType", "account").eq("targetId", accountId))
        .order("desc")
        .take(10),
    ]);
    const members = await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        user: await ctx.db.get(membership.userId),
      })),
    );
    const walletSummaries = await Promise.all(
      wallets.map(async (wallet) => {
        const transactions = await ctx.db
          .query("transactions")
          .withIndex("by_wallet", (q) => q.eq("walletId", wallet._id))
          .collect();
        let totalIncome = 0;
        let totalExpense = 0;
        for (const transaction of transactions) {
          if (transaction.type === "income") totalIncome += transaction.amountMinor;
          else totalExpense += transaction.amountMinor;
        }
        return {
          _id: wallet._id,
          name: wallet.name,
          description: wallet.description,
          currency: wallet.currency,
          archivedAt: wallet.archivedAt,
          transactionCount: transactions.length,
          totalIncome,
          totalExpense,
          balance: totalIncome - totalExpense,
        };
      }),
    );
    return {
      account,
      owner,
      members,
      wallets: walletSummaries.sort((a, b) => a.name.localeCompare(b.name, "es")),
      features: resolveFeatureAccess(overrides),
      featureDefinitions: FEATURE_DEFINITIONS,
      recentAudit,
    };
  },
});

export const listAuditLog = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireSuperadmin(ctx);
    const result = await ctx.db
      .query("adminAuditLog")
      .withIndex("by_created_at")
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (entry) => {
          const actor = await ctx.db.get(entry.actorUserId);
          return {
            ...entry,
            actor: actor
              ? { name: actor.name, email: actor.email, externalId: actor.externalId }
              : null,
          };
        }),
      ),
    };
  },
});

export const setAccountStatus = mutation({
  args: {
    accountId: v.id("accounts"),
    status: accountStatusValidator,
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user: actor } = await requireSuperadmin(ctx);
    const account = await requireAccount(ctx, args.accountId);
    const reason = args.reason?.trim();
    if (args.status === "suspended" && !reason) {
      throw new ConvexError({
        code: "VALIDATION_ERROR",
        message: "Indicá el motivo de la suspensión.",
      });
    }
    const now = Date.now();
    await ctx.db.patch(account._id, {
      status: args.status,
      suspendedAt: args.status === "suspended" ? now : undefined,
      suspendedReason: args.status === "suspended" ? reason : undefined,
      updatedAt: now,
    });
    await audit(
      ctx,
      actor._id,
      args.status === "suspended" ? "account.suspended" : "account.reactivated",
      "account",
      account._id,
      args.status === "suspended"
        ? `Suspendió la cuenta ${account.name}.`
        : `Reactivó la cuenta ${account.name}.`,
      { previousStatus: account.status, reason },
    );
  },
});

export const setFeatureOverride = mutation({
  args: {
    accountId: v.id("accounts"),
    featureKey: v.string(),
    enabled: v.boolean(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user: actor } = await requireSuperadmin(ctx);
    const account = await requireAccount(ctx, args.accountId);
    if (!isFeatureKey(args.featureKey)) {
      throw new ConvexError({ code: "VALIDATION_ERROR", message: "La función no es válida." });
    }
    const definition = FEATURE_DEFINITIONS.find(({ key }) => key === args.featureKey)!;
    if (args.limit !== undefined) {
      if (!definition.supportsLimit || !Number.isSafeInteger(args.limit) || args.limit < 1) {
        throw new ConvexError({ code: "VALIDATION_ERROR", message: "El límite no es válido." });
      }
    }
    const existing = await ctx.db
      .query("accountFeatureOverrides")
      .withIndex("by_account_feature", (q) =>
        q.eq("accountId", account._id).eq("featureKey", args.featureKey),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        limit: args.limit,
        updatedByUserId: actor._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("accountFeatureOverrides", {
        accountId: account._id,
        featureKey: args.featureKey,
        enabled: args.enabled,
        limit: args.limit,
        updatedByUserId: actor._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await audit(
      ctx,
      actor._id,
      "feature.override_set",
      "account",
      account._id,
      `Actualizó ${definition.name} para ${account.name}.`,
      { featureKey: args.featureKey, enabled: args.enabled, limit: args.limit },
    );
  },
});

export const removeFeatureOverride = mutation({
  args: { accountId: v.id("accounts"), featureKey: v.string() },
  handler: async (ctx, args) => {
    const { user: actor } = await requireSuperadmin(ctx);
    const account = await requireAccount(ctx, args.accountId);
    const existing = await ctx.db
      .query("accountFeatureOverrides")
      .withIndex("by_account_feature", (q) =>
        q.eq("accountId", account._id).eq("featureKey", args.featureKey),
      )
      .unique();
    if (!existing) return;
    await ctx.db.delete(existing._id);
    await audit(
      ctx,
      actor._id,
      "feature.override_removed",
      "account",
      account._id,
      `Restauró el acceso predeterminado de ${args.featureKey} para ${account.name}.`,
      { featureKey: args.featureKey },
    );
  },
});

export const setPlatformRole = mutation({
  args: { userId: v.id("users"), role: platformRoleValidator },
  handler: async (ctx, { userId, role }) => {
    const { user: actor } = await requireSuperadmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target || target.deletedAt) {
      throw new ConvexError({ code: "USER_NOT_FOUND", message: "No encontramos este usuario." });
    }
    if (target.platformRole === role) return;
    if (target.platformRole === "superadmin" && role !== "superadmin") {
      const superadmins = await ctx.db
        .query("users")
        .withIndex("by_platform_role", (q) => q.eq("platformRole", "superadmin"))
        .collect();
      if (superadmins.filter((user) => !user.deletedAt).length <= 1) {
        throw new ConvexError({
          code: "LAST_SUPERADMIN",
          message: "Bolsillo debe conservar al menos un superadmin.",
        });
      }
    }
    await ctx.db.patch(target._id, { platformRole: role, updatedAt: Date.now() });
    await audit(
      ctx,
      actor._id,
      "user.platform_role_changed",
      "user",
      target._id,
      `${role === "superadmin" ? "Promovió" : "Quitó como superadmin a"} ${target.name ?? target.email ?? target.externalId}.`,
      { previousRole: target.platformRole, role },
    );
  },
});

export const backfillLegacyWalletOwners = mutation({
  args: {},
  handler: async (ctx) => {
    const { user: actor } = await requireSuperadmin(ctx);
    const legacyWallets = (await ctx.db.query("wallets").collect()).filter(
      (wallet) => !wallet.accountId,
    );
    const ownerIds = [...new Set(legacyWallets.map((wallet) => wallet.ownerId))].slice(0, 100);
    for (const externalId of ownerIds) {
      await upsertUserAndPersonalAccount(ctx, { externalId });
    }
    if (ownerIds.length > 0) {
      await audit(
        ctx,
        actor._id,
        "migration.legacy_wallets_backfilled",
        "system",
        "wallet-account-migration",
        `Migró ${ownerIds.length} propietarios históricos.`,
        { ownerCount: ownerIds.length, walletCount: legacyWallets.length },
      );
    }
    return {
      ownerCount: ownerIds.length,
      walletCount: legacyWallets.length,
      hasMore: legacyWallets.some((wallet) => !ownerIds.includes(wallet.ownerId)),
    };
  },
});
