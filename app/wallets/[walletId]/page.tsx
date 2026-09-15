"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, ArrowDownLeft, ArrowLeft, ArrowUpRight, MoreHorizontal, Pencil, Plus, Tags } from "lucide-react";
import Link from "next/link";
import { notFound, useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui-states";
import { ShareWalletButton } from "@/components/share-wallet-button";
import { TransactionDraftsList } from "@/components/transaction-drafts-list";
import { TransactionList } from "@/components/transaction-list";
import { WalletTabs } from "@/components/wallet-tabs";
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
  const showingDrafts = searchParams.get("view") === "drafts" && canManageTransactions && !wallet.archivedAt;
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

  function setMovementView(view: "posted" | "drafts") {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "drafts") params.set("view", view); else params.delete("view");
    router.replace(`/wallets/${walletId}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  async function archive() {
    if (!window.confirm("¿Archivar este bolsillo? Podrás restaurarlo después.")) return;
    try { await archiveWallet({ walletId }); toast.success("Bolsillo archivado"); router.push("/"); }
    catch (error) { toast.error(errorMessage(error)); }
  }

  return (
    <main className="page-shell wallet-detail">
      <Link className="back-link" href="/"><ArrowLeft /> Bolsillos</Link>
      <WalletTabs walletId={walletId} active="movements" />
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
        <div className="hero-balance"><span>Disponible</span><strong className={wallet.balance < 0 ? "negative" : ""}>{formatMoney(wallet.balance, wallet.currency)}</strong></div>
        <div className="totals-grid"><div className="total income"><span><ArrowDownLeft /> Ingresos</span><strong>{formatMoney(wallet.totalIncome, wallet.currency)}</strong></div><div className="total expense"><span><ArrowUpRight /> Gastos</span><strong>{formatMoney(wallet.totalExpense, wallet.currency)}</strong></div></div>
      </section>
      {!wallet.archivedAt && canManageTransactions && <div className="movement-actions"><Link className="button income-button" href={`/wallets/${walletId}/transactions/new?type=income`}><ArrowDownLeft /> Agregar ingreso</Link><Link className="button expense-button" href={`/wallets/${walletId}/transactions/new?type=expense`}><ArrowUpRight /> Agregar gasto</Link></div>}
      {wallet.archivedAt && <div className="archived-notice"><Archive /> Este bolsillo está archivado. Restauralo para modificarlo.</div>}
      <section className="movements-section">
        <div className="section-title"><div><h2>Movimientos</h2><p className="movement-help">{showingDrafts ? "Sin registrar · Disponibles por 24 horas" : hasActiveFilters ? `${filteredTransactions.length} de ${transactions.length} registros` : `${transactions.length} ${transactions.length === 1 ? "registro" : "registros"}`}</p></div>{!wallet.archivedAt && canManageTransactions && <Link className="icon-link desktop-add" href={`/wallets/${walletId}/transactions/new`} aria-label="Agregar movimiento"><Plus /></Link>}</div>
        {!wallet.archivedAt && canManageTransactions && <div className="movement-list-tabs" aria-label="Estado de los movimientos"><button type="button" aria-pressed={!showingDrafts} onClick={() => setMovementView("posted")}>Registrados</button><button type="button" aria-pressed={showingDrafts} onClick={() => setMovementView("drafts")}>Pendientes</button></div>}
        {!wallet.archivedAt && canManageTransactions && <TransactionDraftsList walletId={walletId} currency={wallet.currency} view={showingDrafts ? "list" : "summary"} onOpen={() => setMovementView("drafts")} />}
        {!showingDrafts && tags.length > 0 && (
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
        {!showingDrafts && hasActiveFilters && <p className="movement-filter-total">Neto de los movimientos filtrados: <strong>{formatMoney(filteredTotals.balance, wallet.currency)}</strong>. El saldo del bolsillo no cambia.</p>}
        {!showingDrafts && <TransactionList transactions={filteredTransactions} currency={wallet.currency} tags={tags} hasActiveFilters={hasActiveFilters} onClearFilters={() => setTagFilters([])} showFiles={canManageFiles} />}
      </section>
    </main>
  );
}
