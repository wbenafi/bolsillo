"use client";

import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { TransactionForm } from "@/components/transaction-form";
import { FeatureUnavailable, LoadingState } from "@/components/ui-states";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TransactionType, WalletSummary } from "@/types/domain";

export default function NewTransactionPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const requestedType = useSearchParams().get("type");
  const initialType: TransactionType = requestedType === "income" ? "income" : "expense";
  const wallet = useQuery(api.wallets.getWallet, { walletId }) as WalletSummary | undefined;
  const canManageTransactions = useFeature("transactions.manage");
  if (!canManageTransactions) return <main className="page-shell"><FeatureUnavailable message="La administración de movimientos está deshabilitada para esta cuenta." /></main>;
  if (!wallet) return <main className="page-shell narrow"><LoadingState /></main>;
  return <main className="page-shell narrow"><Link className="back-link" href={`/wallets/${walletId}`}><ArrowLeft /> Volver a {wallet.name}</Link><section className="page-heading"><p className="eyebrow">{wallet.name}</p><h1>Nuevo movimiento</h1><p>Registralo ahora; el saldo se actualiza al instante.</p></section><TransactionForm walletId={walletId} currency={wallet.currency} initialType={initialType} /></main>;
}
