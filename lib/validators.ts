import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";

export const walletSchema = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre.").max(60, "Usá 60 caracteres o menos."),
  description: z.string().trim().max(240, "Usá 240 caracteres o menos."),
  currency: z.enum(["CRC", "USD"]),
});

export const transactionSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.string().trim().min(1, "Ingresá un monto."),
  description: z.string().trim().min(1, "Ingresá una descripción.").max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá una fecha válida."),
  notes: z.string().trim().max(500, "Usá 500 caracteres o menos."),
  tagIds: z.array(z.custom<Id<"tags">>()),
});

export const tagSchema = z.object({
  label: z.string().trim().min(1, "Ingresá un label.").max(40, "Usá 40 caracteres o menos."),
  color: z.enum(["teal", "blue", "violet", "rose", "orange", "amber", "slate"]),
  description: z.string().trim().max(240, "Usá 240 caracteres o menos."),
});

export type WalletFormValues = z.infer<typeof walletSchema>;
export type TransactionFormValues = z.infer<typeof transactionSchema>;
export type TagFormValues = z.infer<typeof tagSchema>;
