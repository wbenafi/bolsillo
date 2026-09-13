"use client";

import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { WalletTabs } from "@/components/wallet-tabs";
import { StatisticsRangePicker } from "@/components/statistics-range-picker";
import { StatisticsDashboard, type StatisticsSelection } from "@/components/statistics-dashboard";
import { StatisticsTransactions } from "@/components/statistics-transactions";
import { LoadingState } from "@/components/ui-states";
import { todayInputValue } from "@/lib/date";
import { defaultGroup, lastDaysRange, rangeError, statisticsRangeLabel, type DateRange, type StatisticsGroup } from "@/lib/statistics";

function WalletStatisticsPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const searchParams = useSearchParams();
  const router = useRouter();
  const [today] = useState(todayInputValue);
  const fallback = lastDaysRange(today, 30);
  const range = { start: searchParams.get("start") ?? fallback.start, end: searchParams.get("end") ?? fallback.end };
  const validationError = rangeError(range) ?? (range.end > today ? "Elegí una fecha final hasta hoy." : null);
  const groupParam = searchParams.get("group");
  const group: StatisticsGroup = groupParam === "day" || groupParam === "week" || groupParam === "month" ? groupParam : validationError ? "day" : defaultGroup(range);
  const wallet = useQuery(api.wallets.getWallet, { walletId });
  const data = useQuery(api.transactions.getWalletStatistics, validationError ? "skip" : { walletId, ...range, group });
  const [focused, setFocused] = useState<{ rangeKey: string; selection: StatisticsSelection } | null>(null);
  const rangeKey = `${range.start}:${range.end}`;
  const selection = focused?.rangeKey === rangeKey ? focused.selection : { ...range, label: "Movimientos del período" };
  const transactionsHeading = useRef<HTMLHeadingElement>(null);

  function changeRange(next: DateRange, preset: string) {
    const params = new URLSearchParams({ start: next.start, end: next.end, period: preset });
    router.push(`/wallets/${walletId}/statistics?${params}`, { scroll: false });
  }

  function select(next: StatisticsSelection) {
    setFocused({ rangeKey, selection: next });
    transactionsHeading.current?.focus({ preventScroll: true });
    transactionsHeading.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  return <main className="page-shell statistics-page">
    <Link className="back-link" href="/"><ArrowLeft /> Bolsillos</Link>
    <div className="statistics-page-heading"><div><h1>{wallet?.name ?? "Estadísticas del bolsillo"}</h1><p>Entendé lo que entra, lo que sale y lo que cambia.</p></div>{wallet && <Link href={`/wallets/${walletId}`} className="statistics-balance-link">{wallet.currency} · Ver saldo disponible</Link>}</div>
    <WalletTabs walletId={walletId} active="statistics" />
    {wallet?.archivedAt && <p className="statistics-note">Este bolsillo está archivado. Podés seguir consultando su historial.</p>}
    <StatisticsRangePicker key={`${rangeKey}:${searchParams.get("period")}`} range={range} today={today} preset={searchParams.get("period")} onChange={changeRange} />
    {validationError ? <p className="field-error" role="alert">{validationError}</p> : !data ? <LoadingState label="Calculando tus estadísticas…" /> : <>
      <StatisticsDashboard data={data} group={group} onGroupChange={next => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("group", next);
        router.replace(`/wallets/${walletId}/statistics?${params}`, { scroll: false });
      }} onSelect={select} />
      <section className="statistics-section statistics-transactions" aria-labelledby="statistics-transactions-title">
        <div className="statistics-section-heading"><div><h2 id="statistics-transactions-title" ref={transactionsHeading} tabIndex={-1}>{selection.label}</h2><p>{statisticsRangeLabel(selection)}</p></div>{focused?.rangeKey === rangeKey && <button className="button secondary" onClick={() => setFocused(null)}>Ver todo el período</button>}</div>
        <StatisticsTransactions walletId={walletId} currency={data.wallet.currency} tags={data.tags} selection={selection} />
      </section>
    </>}
  </main>;
}

export default function StatisticsPage() {
  return <Suspense fallback={<main className="page-shell"><LoadingState label="Cargando estadísticas…" /></main>}><WalletStatisticsPage /></Suspense>;
}
