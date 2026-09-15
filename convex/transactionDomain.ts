import { validISODate } from "../lib/transaction-extraction";
import { ConvexError, v } from "convex/values";

import { optionalText, requireText } from "./domain";
import { currencyValidator, transactionTypeValidator } from "./schema";
import type { Doc } from "./_generated/dataModel";

export const transactionPreconditions = {
  expectedRevision: v.optional(v.number()),
  currency: v.optional(currencyValidator),
};

/** Check again at commit, including uploads that started before another edit. */
export function requireTransactionPreconditions(
  transaction: Doc<"transactions">,
  wallet: Doc<"wallets">,
  expected: { expectedRevision?: number; currency?: "CRC" | "USD" },
) {
  if (
    expected.expectedRevision !== undefined &&
    expected.expectedRevision !== (transaction.revision ?? 0)
  ) {
    throw new ConvexError({
      code: "TRANSACTION_CONFLICT",
      message:
        "El movimiento cambió en otra sesión. Volvé a abrirlo antes de guardar tus cambios.",
    });
  }
  if (
    expected.currency !== undefined &&
    expected.currency !== wallet.currency
  ) {
    throw new ConvexError({
      code: "CURRENCY_CONFLICT",
      message:
        "La moneda del bolsillo cambió. Volvé a abrir el movimiento y revisá el monto.",
    });
  }
}

export const transactionFields = {
  type: transactionTypeValidator,
  amountMinor: v.number(),
  description: v.string(),
  date: v.string(),
  notes: v.optional(v.string()),
  tagIds: v.optional(v.array(v.id("tags"))),
};

export function validatedTransactionFields(args: {
  type: "income" | "expense";
  amountMinor: number;
  description: string;
  date: string;
  notes?: string;
}) {
  if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0) {
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: "El monto debe ser mayor que cero.",
    });
  }
  if (!validISODate(args.date)) {
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: "La fecha no es válida.",
    });
  }
  return {
    type: args.type,
    amountMinor: args.amountMinor,
    description: requireText(args.description, "La descripción", 100),
    date: args.date,
    notes: optionalText(args.notes, 500),
  };
}
