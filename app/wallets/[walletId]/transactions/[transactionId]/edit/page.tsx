"use client";

import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { TransactionForm } from "@/components/transaction-form";
import { LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WalletSummary, WalletTransaction } from "@/types/domain";

export default function EditTransactionPage() {
  const params = useParams<{ walletId: string; transactionId: string }>();
  const walletId = params.walletId as Id<"wallets">;
  const transactionId = params.transactionId as Id<"transactions">;
  const wallet = useQuery(api.wallets.getWallet, { walletId }) as WalletSummary | undefined;
  const transaction = useQuery(api.transactions.getTransaction, { transactionId }) as WalletTransaction | undefined;
  if (!wallet || !transaction) return <main className="page-shell narrow"><LoadingState /></main>;
  return <main className="page-shell narrow"><Link className="back-link" href={`/wallets/${walletId}`}><ArrowLeft /> Volver a {wallet.name}</Link><section className="page-heading"><p className="eyebrow">Movimiento</p><h1>Editar movimiento</h1></section><TransactionForm walletId={walletId} currency={wallet.currency} transaction={transaction} /></main>;
}
