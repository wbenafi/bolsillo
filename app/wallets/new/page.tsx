"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { WalletForm } from "@/components/wallet-form";
import { FeatureUnavailable } from "@/components/ui-states";
import { useFeature } from "@/components/viewer-context";

export default function NewWalletPage() {
  const canCreateWallets = useFeature("wallets.create");
  if (!canCreateWallets) return <main className="page-shell"><FeatureUnavailable message="La creación de bolsillos está deshabilitada para esta cuenta." /></main>;
  return <main className="page-shell narrow"><Link className="back-link" href="/"><ArrowLeft /> Volver</Link><section className="page-heading"><p className="eyebrow">Un propósito, un saldo claro</p><h1>Nuevo bolsillo</h1><p>Podés cambiar estos datos cuando querás.</p></section><WalletForm /></main>;
}
