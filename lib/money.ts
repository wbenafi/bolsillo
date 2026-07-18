import type { Currency, TransactionType } from "@/types/domain";

const currencyDecimals: Record<Currency, number> = { CRC: 0, USD: 2 };

export function formatMoney(amountMinor: number, currency: Currency) {
  const decimals = currencyDecimals[currency];
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amountMinor / 10 ** decimals);
}

export function parseMoneyInput(value: string, currency: Currency) {
  const normalized = value.trim().replace(/\s/g, "").replace(/,/g, ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const decimals = currencyDecimals[currency];
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  const paddedFraction = fraction.padEnd(decimals, "0");
  const amount = Number.parseInt(`${whole}${paddedFraction}`, 10);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function moneyInputValue(amountMinor: number, currency: Currency) {
  const decimals = currencyDecimals[currency];
  return (amountMinor / 10 ** decimals).toFixed(decimals);
}

export function calculateWalletTotals(
  transactions: ReadonlyArray<{ type: TransactionType; amountMinor: number }>,
) {
  return transactions.reduce(
    (totals, transaction) => {
      if (transaction.type === "income") totals.totalIncome += transaction.amountMinor;
      else totals.totalExpense += transaction.amountMinor;
      totals.balance = totals.totalIncome - totals.totalExpense;
      return totals;
    },
    { totalIncome: 0, totalExpense: 0, balance: 0 },
  );
}

export function getTransactionSign(type: TransactionType) {
  return type === "income" ? "+" : "−";
}
