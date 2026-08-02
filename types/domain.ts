import type { Id } from "@/convex/_generated/dataModel";

export type Currency = "CRC" | "USD";
export type TransactionType = "income" | "expense";
export type TagColor = "teal" | "blue" | "violet" | "rose" | "orange" | "amber" | "slate";

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
  tagIds?: Id<"tags">[];
  createdAt: number;
  updatedAt: number;
};

export type WalletTag = {
  _id: Id<"tags">;
  walletId: Id<"wallets">;
  label: string;
  color: TagColor;
  description?: string;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
};
