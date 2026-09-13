"use client";

import { useQuery } from "convex/react";
import { Archive, Plus } from "lucide-react";
import Link from "next/link";

import { WalletCard } from "@/components/wallet-card";
import { useFeature } from "@/components/viewer-context";
import { EmptyWallets, LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";
import type { WalletSummary } from "@/types/domain";

export default function WalletsPage() {
  const wallets = useQuery(api.wallets.listActiveWallets) as WalletSummary[] | undefined;
  const canCreateWallets = useFeature("wallets.create");

  return (
    <main className="page-shell">
      <section className="page-heading split">
        <div><p className="eyebrow">Tu dinero, por propósito</p><h1>Bolsillos</h1><p>Organizá tu dinero por propósito y mantené cada saldo al día.</p></div>
        {canCreateWallets && <Link className="button primary" href="/wallets/new"><Plus /> Nuevo bolsillo</Link>}
      </section>
      {wallets === undefined ? <LoadingState label="Buscando tus bolsillos…" /> : wallets.length === 0 ? <EmptyWallets canCreate={canCreateWallets} /> : <div className="wallet-grid">{wallets.map((wallet) => <WalletCard wallet={wallet} key={wallet._id} />)}</div>}
      <Link className="archive-link" href="/archived"><Archive /> Ver bolsillos archivados</Link>
    </main>
  );
}
