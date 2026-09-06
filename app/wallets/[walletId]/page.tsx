"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, ArrowDownLeft, ArrowLeft, ArrowUpRight, MoreHorizontal, Pencil, Plus, Tags } from "lucide-react";
import Link from "next/link";
import { notFound, useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui-states";
import { ShareWalletButton } from "@/components/share-wallet-button";
import { TransactionList } from "@/components/transaction-list";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { calculateWalletTotals, formatMoney } from "@/lib/money";
import { filterTransactionsByTagIds } from "@/lib/tags";
import type { WalletSummary, WalletTag, WalletTransaction } from "@/types/domain";

export default function WalletDetailPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const router = useRouter();
  const searchParams = useSearchParams();
  const wallet = useQuery(api.wallets.getWallet, { walletId }) as WalletSummary | undefined;
  const transactions = useQuery(api.transactions.listTransactionsByWallet, { walletId }) as WalletTransaction[] | undefined;
  const tags = useQuery(api.tags.listTagsByWallet, { walletId }) as WalletTag[] | undefined;
  const archiveWallet = useMutation(api.wallets.archiveWallet);
  const canManageTransactions = useFeature("transactions.manage");
  const canManageTags = useFeature("tags.manage");
  const canShare = useFeature("wallets.share");
  const canManageFiles = useFeature("transactions.files");

  if (wallet === null) notFound();
  if (!wallet || !transactions || !tags) return <main className="page-shell"><LoadingState label="Calculando tu saldo…" /></main>;

  const validTagIds = new Set(tags.map((tag) => tag._id));
  const selectedTagIds = [...new Set(searchParams.getAll("tag"))]
    .filter((tagId) => validTagIds.has(tagId as Id<"tags">)) as Id<"tags">[];
  const filteredTransactions = filterTransactionsByTagIds(transactions, selectedTagIds);
  const hasActiveFilters = selectedTagIds.length > 0;
  const filteredTotals = calculateWalletTotals(filteredTransactions);
  const displayedWallet = hasActiveFilters
    ? { ...wallet, ...filteredTotals, transactionCount: filteredTransactions.length }
    : wallet;
  const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag._id));

  function setTagFilters(tagIds: Id<"tags">[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tag");
    tagIds.forEach((tagId) => params.append("tag", tagId));
    const query = params.toString();
    router.replace(`/wallets/${walletId}${query ? `?${query}` : ""}`, { scroll: false });
  }

  function toggleTagFilter(tagId: Id<"tags">) {
    setTagFilters(selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId]);
  }

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
            {canShare && <ShareWalletButton wallet={displayedWallet} transactions={filteredTransactions} filterLabels={selectedTags.map((tag) => tag.label)} />}
            <details className="menu">
              <summary role="button" aria-label="Opciones del bolsillo"><MoreHorizontal /></summary>
              <div><Link href={`/wallets/${walletId}/edit`}><Pencil /> Editar</Link>{canManageTags && <Link href={`/wallets/${walletId}/tags`}><Tags /> Administrar tags</Link>}<button type="button" onClick={archive}><Archive /> Archivar</button></div>
            </details>
          </div>
        </div>
        <div className="hero-balance"><span>{hasActiveFilters ? "Disponible filtrado" : "Disponible"}</span><strong className={displayedWallet.balance < 0 ? "negative" : ""}>{formatMoney(displayedWallet.balance, wallet.currency)}</strong></div>
        <div className="totals-grid"><div className="total income"><span><ArrowDownLeft /> {hasActiveFilters ? "Ingresos filtrados" : "Ingresos"}</span><strong>{formatMoney(displayedWallet.totalIncome, wallet.currency)}</strong></div><div className="total expense"><span><ArrowUpRight /> {hasActiveFilters ? "Gastos filtrados" : "Gastos"}</span><strong>{formatMoney(displayedWallet.totalExpense, wallet.currency)}</strong></div></div>
      </section>
      {!wallet.archivedAt && canManageTransactions && <div className="movement-actions"><Link className="button income-button" href={`/wallets/${walletId}/transactions/new?type=income`}><ArrowDownLeft /> Agregar ingreso</Link><Link className="button expense-button" href={`/wallets/${walletId}/transactions/new?type=expense`}><ArrowUpRight /> Agregar gasto</Link></div>}
      {wallet.archivedAt && <div className="archived-notice"><Archive /> Este bolsillo está archivado. Restauralo para modificarlo.</div>}
      <section className="movements-section">
        <div className="section-title"><div><p className="eyebrow">{hasActiveFilters ? `${filteredTransactions.length} de ${transactions.length} registros` : `${transactions.length} ${transactions.length === 1 ? "registro" : "registros"}`}</p><h2>Movimientos</h2></div>{!wallet.archivedAt && canManageTransactions && <Link className="icon-link desktop-add" href={`/wallets/${walletId}/transactions/new`} aria-label="Agregar movimiento"><Plus /></Link>}</div>
        {tags.length > 0 && (
          <div className="transaction-filters" aria-label="Filtrar movimientos por tags">
            <div className="filter-heading"><span><Tags /> Filtrar por tags</span><Link href={`/wallets/${walletId}/tags`}>Administrar</Link></div>
            <div className="filter-options">
              <button type="button" className={!hasActiveFilters ? "filter-chip active" : "filter-chip"} aria-pressed={!hasActiveFilters} onClick={() => setTagFilters([])}>Todos</button>
              {tags.map((tag) => (
                <button key={tag._id} type="button" className={`filter-chip tag-${tag.color}${selectedTagIds.includes(tag._id) ? " active" : ""}`} aria-pressed={selectedTagIds.includes(tag._id)} onClick={() => toggleTagFilter(tag._id)}>{tag.label}</button>
              ))}
            </div>
            {hasActiveFilters && <button type="button" className="clear-filters" onClick={() => setTagFilters([])}>Limpiar filtros</button>}
          </div>
        )}
        <TransactionList transactions={filteredTransactions} currency={wallet.currency} tags={tags} hasActiveFilters={hasActiveFilters} onClearFilters={() => setTagFilters([])} showFiles={canManageFiles} />
      </section>
    </main>
  );
}
