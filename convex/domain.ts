import { ConvexError } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

export async function requireOwnedWallet(
  ctx: DatabaseContext,
  walletId: Id<"wallets">,
  ownerId: string,
) {
  const wallet = await ctx.db.get(walletId);

  if (!wallet || wallet.ownerId !== ownerId) {
    throw new ConvexError({
      code: "WALLET_NOT_FOUND",
      message: "No encontramos este bolsillo.",
    });
  }

  return wallet;
}

export function requireText(value: string, label: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: `${label} es obligatorio.` });
  }
  if (normalized.length > maxLength) {
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: `${label} no puede superar ${maxLength} caracteres.`,
    });
  }
  return normalized;
}

export function optionalText(value: string | undefined, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: `El texto no puede superar ${maxLength} caracteres.`,
    });
  }
  return normalized;
}
