import type { Id } from "@/convex/_generated/dataModel";
import { todayInputValue } from "./date";
import { moneyInputValue, parseMoneyInput } from "./money";
import {
  extractionFieldNames,
  validISODate,
  type ExtractionResult,
} from "./transaction-extraction";
import { transactionSchema, type TransactionFormValues } from "./validators";
import type {
  Currency,
  TransactionType,
  WalletTag,
  WalletTransaction,
} from "@/types/domain";

export type TransactionStep = 1 | 2 | 3;
export type TransactionMode = "manual" | "documents";
export type TransactionErrors = Partial<
  Record<keyof TransactionFormValues, string>
>;

export function initialTransactionValues(
  currency: Currency,
  initialType: TransactionType,
  transaction?: WalletTransaction,
): TransactionFormValues {
  return {
    type: transaction?.type ?? initialType,
    amount: transaction
      ? moneyInputValue(transaction.amountMinor, currency)
      : "",
    description: transaction?.description ?? "",
    date: transaction?.date ?? todayInputValue(),
    notes: transaction?.notes ?? "",
    tagIds: transaction?.tagIds ?? [],
  };
}

export function validateTransaction(
  values: TransactionFormValues,
  currency: Currency,
  needsAmountReview = false,
): TransactionErrors {
  const parsed = transactionSchema.safeParse(values);
  const errors: TransactionErrors = parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path[0], issue.message]),
      );
  if (!parseMoneyInput(values.amount, currency))
    errors.amount =
      "Ingresá un monto mayor que cero con hasta dos decimales, sin puntos ni comas de miles.";
  else if (needsAmountReview)
    errors.amount = "Confirmá que revisaste el monto del comprobante.";
  if (!validISODate(values.date)) errors.date = "Elegí una fecha válida.";
  return errors;
}

export function transactionImpact(
  balance: number,
  type: TransactionType,
  amountMinor: number,
  original?: Pick<WalletTransaction, "type" | "amountMinor">,
) {
  const previous = original
    ? (original.type === "income" ? 1 : -1) * original.amountMinor
    : 0;
  const next = (type === "income" ? 1 : -1) * amountMinor;
  return { delta: next - previous, balance: balance - previous + next };
}

export function matchingReceiptTags(
  value: string[],
  tags: WalletTag[],
): Id<"tags">[] {
  const labels = new Set(value.map((label) => label.toLocaleLowerCase("es")));
  return tags
    .filter((tag) => labels.has(tag.label.toLocaleLowerCase("es")))
    .map((tag) => tag._id);
}

/** Fill only empty fields. A delayed result must never replace the user's input. */
export function applyReceiptToEmptyFields(
  values: TransactionFormValues,
  result: ExtractionResult,
  reviewed: string[],
  tags: WalletTag[],
): TransactionFormValues {
  const next = { ...values };
  for (const key of extractionFieldNames) {
    const field = result.fields[key];
    if (
      reviewed.includes(key) ||
      field.value === null ||
      !["high", "medium"].includes(field.confidence) ||
      (key === "amount" && result.currencyMismatch)
    )
      continue;
    if (key === "tags") {
      if (!next.tagIds.length)
        next.tagIds = matchingReceiptTags(field.value as string[], tags);
    } else if (!next[key]) {
      if (key === "type") next.type = field.value as TransactionType;
      else next[key] = field.value as string;
    }
  }
  return next;
}
