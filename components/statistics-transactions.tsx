"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TransactionList } from "@/components/transaction-list";
import { LoadingState } from "@/components/ui-states";
import type { StatisticsSelection } from "@/components/statistics-dashboard";
import type { Currency, WalletTag } from "@/types/domain";

export function StatisticsTransactions({ walletId, currency, tags, selection }: {
  walletId: Id<"wallets">;
  currency: Currency;
  tags: WalletTag[];
  selection: StatisticsSelection;
}) {
  const { results, status, loadMore } = usePaginatedQuery(api.transactions.listStatisticsTransactions, {
    walletId, start: selection.start, end: selection.end,
    type: selection.type, tagId: selection.tagId as Id<"tags"> | null | undefined,
  }, { initialNumItems: 30 });

  if (status === "LoadingFirstPage") return <LoadingState label="Buscando los movimientos…" />;
  return <>
    {results.length > 0 ? <TransactionList transactions={results} currency={currency} tags={tags} /> : <p className="statistics-note">{status === "Exhausted" ? "No hay movimientos que coincidan con esta selección." : "Todavía no hay coincidencias en los registros revisados. Cargá más para seguir buscando."}</p>}
    {status !== "Exhausted" && <button type="button" className="button secondary statistics-load-more" disabled={status === "LoadingMore"} onClick={() => loadMore(30)}>{status === "LoadingMore" ? "Cargando…" : "Cargar más movimientos"}</button>}
  </>;
}
