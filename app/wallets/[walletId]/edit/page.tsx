"use client";

import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { LoadingState } from "@/components/ui-states";
import { WalletForm } from "@/components/wallet-form";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WalletSummary } from "@/types/domain";

export default function EditWalletPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const wallet = useQuery(api.wallets.getWallet, { walletId }) as WalletSummary | undefined;
  if (!wallet) return <main className="page-shell narrow"><LoadingState /></main>;
  return <main className="page-shell narrow"><Link className="back-link" href={`/wallets/${walletId}`}><ArrowLeft /> Volver al bolsillo</Link><section className="page-heading"><p className="eyebrow">Ajustes del bolsillo</p><h1>Editar bolsillo</h1></section><WalletForm walletId={walletId} initialValues={wallet} /></main>;
}
