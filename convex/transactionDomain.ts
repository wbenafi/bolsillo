import { ConvexError, v } from "convex/values";

import { optionalText, requireText } from "./domain";
import { transactionTypeValidator } from "./schema";

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
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "El monto debe ser mayor que cero." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(`${args.date}T00:00:00`))) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "La fecha no es válida." });
  }
  return {
    type: args.type,
    amountMinor: args.amountMinor,
    description: requireText(args.description, "La descripción", 100),
    date: args.date,
    notes: optionalText(args.notes, 500),
  };
}
