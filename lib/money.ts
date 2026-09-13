import type { Currency, TransactionType } from "@/types/domain";

// All persisted amounts use integer hundredths for CRC and USD.
const currencyDecimals: Record<Currency, number> = { CRC: 2, USD: 2 };

export function addMoney(a: number, b: number) {
  const sum = a + b;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(sum)) {
    throw new Error("El total excede la precisión soportada.");
  }
  return sum;
}

export function formatMoney(amountMinor: number, currency: Currency) {
  const decimals = currencyDecimals[currency];
  const [whole, fraction] = moneyInputValue(amountMinor, currency).split(".");
  // Format the integer part separately so a JS decimal conversion cannot lose
  // cents near MAX_SAFE_INTEGER. Preserve the sign of amounts like -0.01.
  const integer = whole === "-0" ? -0 : BigInt(whole);
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).formatToParts(integer).map(part => part.type === "fraction" ? fraction : part.value).join("");
}

export function parseMoneyInput(value: string, currency: Currency) {
  // Spaces can group thousands, but must form complete groups. A single comma
  // or period is decimal; reject mixed/ambiguous punctuation rather than guess.
  let normalized = value.trim();
  if (/\s/.test(normalized)) {
    if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
    normalized = normalized.replace(/[ \u00a0\u202f]/g, "");
  }
  normalized = normalized.replace(/,/g, ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const decimals = currencyDecimals[currency];
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  const paddedFraction = fraction.padEnd(decimals, "0");
  const amount = Number.parseInt(`${whole}${paddedFraction}`, 10);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function moneyInputValue(amountMinor: number, currency: Currency) {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("El monto excede la precisión soportada.");
  const decimals = currencyDecimals[currency];
  const digits = Math.abs(amountMinor).toString().padStart(decimals + 1, "0");
  return `${amountMinor < 0 ? "-" : ""}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

export function calculateWalletTotals(
  transactions: ReadonlyArray<{ type: TransactionType; amountMinor: number }>,
) {
  return transactions.reduce(
    (totals, transaction) => {
      if (transaction.type === "income") totals.totalIncome = addMoney(totals.totalIncome, transaction.amountMinor);
      else totals.totalExpense = addMoney(totals.totalExpense, transaction.amountMinor);
      totals.balance = addMoney(totals.totalIncome, -totals.totalExpense);
      return totals;
    },
    { totalIncome: 0, totalExpense: 0, balance: 0 },
  );
}

export function getTransactionSign(type: TransactionType) {
  return type === "income" ? "+" : "−";
}
