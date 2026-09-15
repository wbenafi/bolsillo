"use client";

import { useQuery } from "convex/react";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { TransactionForm } from "@/components/transaction-form";
import { FeatureUnavailable, LoadingState } from "@/components/ui-states";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function EditTransactionPage() {
  const params = useParams<{ walletId: string; transactionId: string }>();
  const walletId = params.walletId as Id<"wallets">;
  const transactionId = params.transactionId as Id<"transactions">;
  const wallet = useQuery(api.wallets.getWallet, { walletId });
  const transaction = useQuery(api.transactions.getTransaction, {
    transactionId,
  });
  const canManage = useFeature("transactions.manage");
  const [openedId, setOpenedId] = useState<string>();
  // Live availability changes must not unmount an editor with local work.
  // The editor disables saving and retains its values until access is restored.
  if (
    wallet &&
    transaction &&
    canManage &&
    !wallet.archivedAt &&
    openedId !== transactionId
  )
    setOpenedId(transactionId);
  const alreadyOpened = openedId === transactionId;
  if (wallet === null || (transaction && transaction.walletId !== walletId))
    notFound();
  if (!canManage && !alreadyOpened)
    return (
      <main className="page-shell">
        <FeatureUnavailable message="La administración de movimientos está deshabilitada para esta cuenta." />
      </main>
    );
  if (!wallet || !transaction)
    return (
      <main className="page-shell narrow">
        <LoadingState />
      </main>
    );
  if (wallet.archivedAt && !alreadyOpened)
    return (
      <main className="page-shell narrow">
        <FeatureUnavailable message="Restaurá el bolsillo para editar movimientos." />
      </main>
    );
  return (
    <main className="page-shell narrow movement-page">
      <TransactionForm
        key={transactionId}
        wallet={wallet}
        transaction={transaction}
      />
    </main>
  );
}
