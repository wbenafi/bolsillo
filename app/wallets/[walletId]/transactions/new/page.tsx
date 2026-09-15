"use client";

import { useQuery } from "convex/react";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { TransactionForm } from "@/components/transaction-form";
import { FeatureUnavailable, LoadingState } from "@/components/ui-states";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function NewTransactionPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const requestedType = useSearchParams().get("type");
  const wallet = useQuery(api.wallets.getWallet, { walletId });
  const canManage = useFeature("transactions.manage");
  if (wallet === null) notFound();
  if (!canManage)
    return (
      <main className="page-shell">
        <FeatureUnavailable message="La administración de movimientos está deshabilitada para esta cuenta." />
      </main>
    );
  if (!wallet)
    return (
      <main className="page-shell narrow">
        <LoadingState />
      </main>
    );
  if (wallet.archivedAt)
    return (
      <main className="page-shell narrow">
        <FeatureUnavailable message="Restaurá el bolsillo para agregar o continuar movimientos." />
      </main>
    );
  return (
    <main className="page-shell narrow movement-page">
      <TransactionForm
        key={walletId}
        wallet={wallet}
        initialType={requestedType === "income" ? "income" : "expense"}
      />
    </main>
  );
}
