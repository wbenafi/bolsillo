import { ConvexError } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { FeatureKey } from "../lib/features";

type AuthContext = Pick<QueryCtx | MutationCtx, "auth">;
type DatabaseContext = Pick<QueryCtx | MutationCtx, "auth" | "db">;

export function isBootstrapSuperadmin(externalId: string) {
  return (process.env.SUPERADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(externalId);
}

export async function requireIdentity(ctx: AuthContext) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity?.subject) {
    throw new ConvexError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Iniciá sesión para continuar.",
    });
  }

  return identity;
}

export async function findCurrentUser(ctx: DatabaseContext) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
    .unique();
  return { identity, user };
}

async function accountForUser(ctx: DatabaseContext, user: Doc<"users">) {
  if (user.personalAccountId) {
    const account = await ctx.db.get(user.personalAccountId);
    if (account) return account;
  }

  return await ctx.db
    .query("accounts")
    .withIndex("by_primary_owner", (q) => q.eq("primaryOwnerUserId", user._id))
    .unique();
}

export async function requireCurrentUser(ctx: DatabaseContext) {
  const { identity, user } = await findCurrentUser(ctx);
  if (!user || user.deletedAt) {
    throw new ConvexError({
      code: "ACCOUNT_SETUP_REQUIRED",
      message: "Estamos preparando tu cuenta. Recargá la página para continuar.",
    });
  }
  return { identity, user };
}

export async function requireAccountContext(ctx: DatabaseContext) {
  const { identity, user } = await requireCurrentUser(ctx);
  const account = await accountForUser(ctx, user);
  if (!account) {
    throw new ConvexError({
      code: "ACCOUNT_SETUP_REQUIRED",
      message: "Estamos preparando tu cuenta. Recargá la página para continuar.",
    });
  }
  if (account.status === "suspended") {
    throw new ConvexError({
      code: "ACCOUNT_SUSPENDED",
      message: "Esta cuenta está suspendida. Contactá al equipo de Bolsillo para obtener ayuda.",
    });
  }
  return { identity, user, account, ownerId: identity.subject };
}

export async function requireSuperadmin(ctx: DatabaseContext) {
  const { identity, user } = await requireCurrentUser(ctx);
  if (user.platformRole !== "superadmin" && !isBootstrapSuperadmin(identity.subject)) {
    throw new ConvexError({
      code: "SUPERADMIN_REQUIRED",
      message: "No tenés permiso para acceder a la administración de Bolsillo.",
    });
  }
  return { identity, user };
}

export async function requireFeature(
  ctx: DatabaseContext,
  accountId: Doc<"accounts">["_id"],
  featureKey: FeatureKey,
) {
  const override = await ctx.db
    .query("accountFeatureOverrides")
    .withIndex("by_account_feature", (q) =>
      q.eq("accountId", accountId).eq("featureKey", featureKey),
    )
    .unique();
  if (override && !override.enabled) {
    throw new ConvexError({
      code: "FEATURE_DISABLED",
      message: "Esta función no está habilitada para tu cuenta.",
    });
  }
  return override;
}
