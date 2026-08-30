import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { findCurrentUser, isBootstrapSuperadmin, requireIdentity } from "./auth";
import { resolveFeatureAccess } from "../lib/features";

type UserProfile = {
  externalId: string;
  tokenIdentifier?: string;
  name?: string;
  email?: string;
  imageUrl?: string;
};

function normalizedOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function accountName(profile: UserProfile) {
  return profile.name ?? profile.email ?? "Cuenta personal";
}

function searchText(profile: UserProfile) {
  return [profile.name, profile.email, profile.externalId]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("es");
}

export async function upsertUserAndPersonalAccount(
  ctx: MutationCtx,
  profile: UserProfile,
  options?: { markSeen?: boolean },
) {
  const now = Date.now();
  let user = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", profile.externalId))
    .unique();

  if (user) {
    await ctx.db.patch(user._id, {
      tokenIdentifier: profile.tokenIdentifier ?? user.tokenIdentifier,
      name: profile.name ?? user.name,
      email: profile.email ?? user.email,
      imageUrl: profile.imageUrl ?? user.imageUrl,
      platformRole: isBootstrapSuperadmin(profile.externalId)
        ? "superadmin"
        : user.platformRole,
      updatedAt: now,
      lastSeenAt: options?.markSeen ? now : user.lastSeenAt,
      deletedAt: undefined,
    });
    user = (await ctx.db.get(user._id))!;
  } else {
    const userId = await ctx.db.insert("users", {
      ...profile,
      platformRole: isBootstrapSuperadmin(profile.externalId) ? "superadmin" : "member",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: options?.markSeen ? now : undefined,
    });
    user = (await ctx.db.get(userId))!;
  }

  let account = user.personalAccountId ? await ctx.db.get(user.personalAccountId) : null;
  if (!account) {
    account = await ctx.db
      .query("accounts")
      .withIndex("by_primary_owner", (q) => q.eq("primaryOwnerUserId", user!._id))
      .unique();
  }

  if (!account) {
    const accountId = await ctx.db.insert("accounts", {
      name: accountName(profile),
      kind: "personal",
      status: "active",
      primaryOwnerUserId: user._id,
      searchText: searchText(profile),
      createdAt: now,
      updatedAt: now,
    });
    account = (await ctx.db.get(accountId))!;
  } else {
    await ctx.db.patch(account._id, {
      name: profile.name ?? profile.email ?? account.name,
      searchText: searchText({
        ...profile,
        name: profile.name ?? user.name,
        email: profile.email ?? user.email,
      }),
      updatedAt: now,
    });
    account = (await ctx.db.get(account._id))!;
  }

  if (user.personalAccountId !== account._id) {
    await ctx.db.patch(user._id, { personalAccountId: account._id, updatedAt: now });
  }

  const membership = await ctx.db
    .query("accountMembers")
    .withIndex("by_account_user", (q) =>
      q.eq("accountId", account!._id).eq("userId", user!._id),
    )
    .unique();
  if (!membership) {
    await ctx.db.insert("accountMembers", {
      accountId: account._id,
      userId: user._id,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
  }

  const legacyWallets = await ctx.db
    .query("wallets")
    .withIndex("by_owner", (q) => q.eq("ownerId", profile.externalId))
    .collect();
  await Promise.all(
    legacyWallets
      .filter((wallet) => !wallet.accountId)
      .map((wallet) => ctx.db.patch(wallet._id, { accountId: account!._id })),
  );

  return { userId: user._id, accountId: account._id };
}

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return await upsertUserAndPersonalAccount(
      ctx,
      {
        externalId: identity.subject,
        tokenIdentifier: identity.tokenIdentifier,
        name: normalizedOptional(identity.name),
        email: normalizedOptional(identity.email),
        imageUrl: normalizedOptional(identity.pictureUrl),
      },
      { markSeen: true },
    );
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await findCurrentUser(ctx);
    if (!user || user.deletedAt) return null;
    const account = user.personalAccountId ? await ctx.db.get(user.personalAccountId) : null;
    if (!account) return null;
    const overrides = await ctx.db
      .query("accountFeatureOverrides")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return {
      user: {
        _id: user._id,
        externalId: user.externalId,
        name: user.name,
        email: user.email,
        imageUrl: user.imageUrl,
        platformRole: user.platformRole,
      },
      account: {
        _id: account._id,
        name: account.name,
        status: account.status,
        suspendedReason: account.suspendedReason,
      },
      features: resolveFeatureAccess(overrides),
    };
  },
});

export const upsertFromClerk = internalMutation({
  args: {
    externalId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => await upsertUserAndPersonalAccount(ctx, args),
});

export const markDeletedFromClerk = internalMutation({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    if (!user) return;
    const now = Date.now();
    await ctx.db.patch(user._id, { deletedAt: now, updatedAt: now });
    if (user.personalAccountId) {
      const account = await ctx.db.get(user.personalAccountId);
      if (account) {
        await ctx.db.patch(account._id, {
          status: "suspended",
          suspendedAt: now,
          suspendedReason: "El usuario fue eliminado en Clerk.",
          updatedAt: now,
        });
      }
    }
  },
});

export type Viewer = {
  user: {
    _id: Id<"users">;
    externalId: string;
    name?: string;
    email?: string;
    imageUrl?: string;
    platformRole: "member" | "superadmin";
  };
  account: {
    _id: Id<"accounts">;
    name: string;
    status: "active" | "suspended";
    suspendedReason?: string;
  };
  features: ReturnType<typeof resolveFeatureAccess>;
};
