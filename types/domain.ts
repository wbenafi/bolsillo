import type { Id } from "@/convex/_generated/dataModel";

export type Currency = "CRC" | "USD";
export type TransactionType = "income" | "expense";

export type WalletSummary = {
  _id: Id<"wallets">;
  name: string;
  description?: string;
  currency: Currency;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  latestMovementAt?: string;
  transactionCount: number;
};

export type WalletTransaction = {
  _id: Id<"transactions">;
  walletId: Id<"wallets">;
  type: TransactionType;
  amountMinor: number;
  description: string;
  date: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
};
