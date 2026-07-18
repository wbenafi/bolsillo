import { ConvexError } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthContext = Pick<QueryCtx | MutationCtx, "auth">;

export async function requireOwnerId(ctx: AuthContext) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity?.subject) {
    throw new ConvexError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Iniciá sesión para continuar.",
    });
  }

  return identity.subject;
}
