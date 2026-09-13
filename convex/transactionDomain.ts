import { validISODate } from "../lib/transaction-extraction";
import { ConvexError, v } from "convex/values";

import { optionalText, requireText } from "./domain";
import { transactionTypeValidator } from "./schema";
import { currentMoneyAmount, MONEY_VERSION } from "../lib/money";
import type { Currency } from "../types/domain";

// Optional in the validator so old clients receive an actionable error.
export const moneyVersionFields = { moneyVersion: v.optional(v.literal(MONEY_VERSION)) };

export function requireMoneyVersion(version: number | undefined) {
  if (version !== MONEY_VERSION) {
    throw new ConvexError({ code: "MONEY_VERSION_REQUIRED", message: "Actualizá la página para usar montos con decimales. Tus datos no se modificaron." });
  }
}

export function currentTransaction<T extends { amountMinor: number; moneyVersion?: typeof MONEY_VERSION }>(transaction: T, currency: Currency) {
  return { ...transaction, amountMinor: currentMoneyAmount(transaction, currency), moneyVersion: MONEY_VERSION };
}

export const transactionFields = {
  ...moneyVersionFields,
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
  moneyVersion?: typeof MONEY_VERSION;
  description: string;
  date: string;
  notes?: string;
}) {
  requireMoneyVersion(args.moneyVersion);
  if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "El monto debe ser mayor que cero." });
  }
  if (!validISODate(args.date)) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "La fecha no es válida." });
  }
  return {
    type: args.type,
    amountMinor: args.amountMinor,
    moneyVersion: MONEY_VERSION,
    description: requireText(args.description, "La descripción", 100),
    date: args.date,
    notes: optionalText(args.notes, 500),
  };
}
