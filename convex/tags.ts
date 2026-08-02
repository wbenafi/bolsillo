import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireOwnerId } from "./auth";
import { optionalText, requireOwnedWallet, requireText } from "./domain";
import { tagColorValidator } from "./schema";

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

const tagFields = {
  label: v.string(),
  color: tagColorValidator,
  description: v.optional(v.string()),
};

function validatedFields(args: {
  label: string;
  color: Doc<"tags">["color"];
  description?: string;
}) {
  const label = requireText(args.label.trim().replace(/\s+/g, " "), "El label", 40);
  return {
    label,
    normalizedLabel: label.toLocaleLowerCase("es"),
    color: args.color,
    description: optionalText(args.description, 240),
  };
}

async function requireUniqueLabel(
  ctx: DatabaseContext,
  walletId: Id<"wallets">,
  normalizedLabel: string,
  ignoredTagId?: Id<"tags">,
) {
  const existing = await ctx.db
    .query("tags")
    .withIndex("by_wallet_normalized_label", (q) =>
      q.eq("walletId", walletId).eq("normalizedLabel", normalizedLabel),
    )
    .first();
  if (existing && existing._id !== ignoredTagId) {
    throw new ConvexError({
      code: "TAG_LABEL_TAKEN",
      message: "Ya existe un tag con ese label en este bolsillo.",
    });
  }
}

async function requireOwnedTag(ctx: DatabaseContext, tagId: Id<"tags">, ownerId: string) {
  const tag = await ctx.db.get(tagId);
  if (!tag || tag.ownerId !== ownerId) {
    throw new ConvexError({ code: "TAG_NOT_FOUND", message: "No encontramos este tag." });
  }
  await requireOwnedWallet(ctx, tag.walletId, ownerId);
  return tag;
}

export async function validateAssignedTagIds(
  ctx: DatabaseContext,
  tagIds: Id<"tags">[] | undefined,
  walletId: Id<"wallets">,
  ownerId: string,
) {
  if (!tagIds?.length) return undefined;
  const uniqueTagIds = [...new Set(tagIds)] as Id<"tags">[];
  const tags = await Promise.all(uniqueTagIds.map((tagId) => ctx.db.get(tagId)));
  if (tags.some((tag) => !tag || tag.ownerId !== ownerId || tag.walletId !== walletId)) {
    throw new ConvexError({
      code: "INVALID_TRANSACTION_TAG",
      message: "Uno de los tags seleccionados no pertenece a este bolsillo.",
    });
  }
  return uniqueTagIds;
}

export const listTagsByWallet = query({
  args: { walletId: v.id("wallets") },
  handler: async (ctx, { walletId }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedWallet(ctx, walletId, ownerId);
    const [tags, transactions] = await Promise.all([
      ctx.db.query("tags").withIndex("by_wallet", (q) => q.eq("walletId", walletId)).collect(),
      ctx.db.query("transactions").withIndex("by_wallet", (q) => q.eq("walletId", walletId)).collect(),
    ]);
    const usageCounts = new Map<Id<"tags">, number>();
    for (const transaction of transactions) {
      for (const tagId of transaction.tagIds ?? []) {
        usageCounts.set(tagId, (usageCounts.get(tagId) ?? 0) + 1);
      }
    }
    return tags
      .map((tag) => ({
        ...tag,
        usageCount: usageCounts.get(tag._id) ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));
  },
});

export const createTag = mutation({
  args: { walletId: v.id("wallets"), ...tagFields },
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const wallet = await requireOwnedWallet(ctx, args.walletId, ownerId);
    if (wallet.archivedAt) {
      throw new ConvexError({ code: "WALLET_ARCHIVED", message: "Restaurá el bolsillo para agregar tags." });
    }
    const fields = validatedFields(args);
    await requireUniqueLabel(ctx, args.walletId, fields.normalizedLabel);
    const now = Date.now();
    return await ctx.db.insert("tags", {
      ownerId,
      walletId: args.walletId,
      ...fields,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTag = mutation({
  args: { tagId: v.id("tags"), ...tagFields },
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const tag = await requireOwnedTag(ctx, args.tagId, ownerId);
    const wallet = await requireOwnedWallet(ctx, tag.walletId, ownerId);
    if (wallet.archivedAt) {
      throw new ConvexError({ code: "WALLET_ARCHIVED", message: "Restaurá el bolsillo para editar tags." });
    }
    const fields = validatedFields(args);
    await requireUniqueLabel(ctx, tag.walletId, fields.normalizedLabel, tag._id);
    await ctx.db.patch(tag._id, { ...fields, updatedAt: Date.now() });
  },
});

export const deleteTag = mutation({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    const ownerId = await requireOwnerId(ctx);
    const tag = await requireOwnedTag(ctx, tagId, ownerId);
    const wallet = await requireOwnedWallet(ctx, tag.walletId, ownerId);
    if (wallet.archivedAt) {
      throw new ConvexError({ code: "WALLET_ARCHIVED", message: "Restaurá el bolsillo para eliminar tags." });
    }
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_wallet", (q) => q.eq("walletId", tag.walletId))
      .collect();
    const taggedTransactions = transactions.filter((transaction) => transaction.tagIds?.includes(tagId));
    await Promise.all(taggedTransactions.map((transaction) => {
      const tagIds = transaction.tagIds?.filter((id) => id !== tagId);
      return ctx.db.patch(transaction._id, {
        tagIds: tagIds?.length ? tagIds : undefined,
        updatedAt: Date.now(),
      });
    }));
    await ctx.db.delete(tagId);
  },
});
