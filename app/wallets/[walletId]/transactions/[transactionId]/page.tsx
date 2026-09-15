"use client";

import { useQuery } from "convex/react";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { TransactionDetail } from "@/components/transaction-flow/transaction-detail";
import { LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WalletTransaction } from "@/types/domain";

export default function TransactionDetailPage() {
  const params = useParams<{ walletId: string; transactionId: string }>();
  const walletId = params.walletId as Id<"wallets">;
  const transactionId = params.transactionId as Id<"transactions">;
  const [deleting, setDeleting] = useState(false);
  const [snapshot, setSnapshot] = useState<WalletTransaction>();
  const wallet = useQuery(api.wallets.getWallet, { walletId });
  const current = useQuery(
    api.transactions.getTransaction,
    deleting ? "skip" : { transactionId },
  );
  const transaction = deleting ? snapshot : current;
  if (wallet === null || (transaction && transaction.walletId !== walletId))
    notFound();
  if (!wallet || !transaction)
    return (
      <main className="page-shell narrow">
        <LoadingState />
      </main>
    );
  return (
    <main className="page-shell narrow movement-page">
      <TransactionDetail
        wallet={wallet}
        transaction={transaction}
        onDeleting={(value) => {
          if (value) setSnapshot(transaction);
          setDeleting(value);
        }}
      />
    </main>
  );
}
