"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, ArrowDownLeft, ArrowLeft, ArrowUpRight, MoreHorizontal, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui-states";
import { ShareWalletButton } from "@/components/share-wallet-button";
import { TransactionList } from "@/components/transaction-list";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import type { WalletSummary, WalletTransaction } from "@/types/domain";

export default function WalletDetailPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const router = useRouter();
  const wallet = useQuery(api.wallets.getWallet, { walletId }) as WalletSummary | undefined;
  const transactions = useQuery(api.transactions.listTransactionsByWallet, { walletId }) as WalletTransaction[] | undefined;
  const archiveWallet = useMutation(api.wallets.archiveWallet);

  if (wallet === null) notFound();
  if (!wallet || !transactions) return <main className="page-shell"><LoadingState label="Calculando tu saldo…" /></main>;

  async function archive() {
    if (!window.confirm("¿Archivar este bolsillo? Podrás restaurarlo después.")) return;
    try { await archiveWallet({ walletId }); toast.success("Bolsillo archivado"); router.push("/"); }
    catch (error) { toast.error(errorMessage(error)); }
  }

  return (
    <main className="page-shell wallet-detail">
      <Link className="back-link" href="/"><ArrowLeft /> Bolsillos</Link>
      <section className="wallet-hero">
        <div className="wallet-title">
          <div><p className="eyebrow">{wallet.currency}</p><h1>{wallet.name}</h1>{wallet.description && <p>{wallet.description}</p>}</div>
          <div className="wallet-title-actions">
            <ShareWalletButton wallet={wallet} transactions={transactions} />
            <details className="menu">
              <summary role="button" aria-label="Opciones del bolsillo"><MoreHorizontal /></summary>
              <div><Link href={`/wallets/${walletId}/edit`}><Pencil /> Editar</Link><button type="button" onClick={archive}><Archive /> Archivar</button></div>
            </details>
          </div>
        </div>
        <div className="hero-balance"><span>Disponible</span><strong className={wallet.balance < 0 ? "negative" : ""}>{formatMoney(wallet.balance, wallet.currency)}</strong></div>
        <div className="totals-grid"><div className="total income"><span><ArrowDownLeft /> Ingresos</span><strong>{formatMoney(wallet.totalIncome, wallet.currency)}</strong></div><div className="total expense"><span><ArrowUpRight /> Gastos</span><strong>{formatMoney(wallet.totalExpense, wallet.currency)}</strong></div></div>
      </section>
      {!wallet.archivedAt && <div className="movement-actions"><Link className="button income-button" href={`/wallets/${walletId}/transactions/new?type=income`}><ArrowDownLeft /> Agregar ingreso</Link><Link className="button expense-button" href={`/wallets/${walletId}/transactions/new?type=expense`}><ArrowUpRight /> Agregar gasto</Link></div>}
      {wallet.archivedAt && <div className="archived-notice"><Archive /> Este bolsillo está archivado. Restauralo para modificarlo.</div>}
      <section className="movements-section"><div className="section-title"><div><p className="eyebrow">{transactions.length} {transactions.length === 1 ? "registro" : "registros"}</p><h2>Movimientos</h2></div>{!wallet.archivedAt && <Link className="icon-link desktop-add" href={`/wallets/${walletId}/transactions/new`} aria-label="Agregar movimiento"><Plus /></Link>}</div><TransactionList transactions={transactions} currency={wallet.currency} /></section>
    </main>
  );
}
