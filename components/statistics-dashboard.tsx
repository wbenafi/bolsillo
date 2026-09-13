"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowRight } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { formatMoney } from "@/lib/money";
import { amountChange, statisticsDate, statisticsRangeLabel, type DateRange, type StatisticsGroup } from "@/lib/statistics";
import type { Currency, TransactionType } from "@/types/domain";

export type WalletStatistics = FunctionReturnType<typeof api.transactions.getWalletStatistics>;
export type StatisticsSelection = DateRange & { type?: TransactionType; tagId?: string | null; label: string };

const percentFormatter = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 1 });

function comparisonLabel(current: number, previous: number, currency: Currency, available: boolean) {
  if (!available) return "Historial insuficiente para comparar";
  const change = amountChange(current, previous);
  if (change.amount === 0) return "Sin cambios respecto al período anterior";
  const direction = change.amount > 0 ? "más" : "menos";
  const percentage = change.percent === null ? " · sin base porcentual" : ` (${percentFormatter.format(Math.abs(change.percent))}%)`;
  return `${formatMoney(Math.abs(change.amount), currency)} ${direction}${percentage}`;
}

export function StatisticsDashboard({ data, group, onGroupChange, onSelect }: {
  data: WalletStatistics;
  group: StatisticsGroup;
  onGroupChange: (group: StatisticsGroup) => void;
  onSelect: (selection: StatisticsSelection) => void;
}) {
  const [breakdownType, setBreakdownType] = useState<TransactionType>("expense");
  const currency = data.wallet.currency;
  // Averages and chart ticks may fall between minor units; format whole minor
  // units so both CRC and USD retain their supported currency precision.
  const money = (value: number) => formatMoney(Math.round(value), currency);
  const breakdown = data.breakdown[breakdownType];
  const tagsById = new Map<string, WalletStatistics["tags"][number]>(data.tags.map(tag => [tag._id, tag]));
  const maximum = Math.max(1, ...data.trend.map(bucket => Math.max(bucket.income, bucket.expense)));
  const topExpense = data.breakdown.expense.rows[0];
  const largestBucket = data.trend.reduce<(typeof data.trend)[number] | null>((largest, bucket) => !largest || bucket.expense > largest.expense ? bucket : largest, null);
  const selectType = (type?: TransactionType) => onSelect({ ...data.range, type, label: type === "income" ? "Ingresos del período" : type === "expense" ? "Gastos del período" : "Movimientos del período" });

  return (
    <div className="statistics-dashboard">
      <section aria-labelledby="statistics-summary-title" className="statistics-summary">
        <div className="statistics-section-heading"><div><h2 id="statistics-summary-title">Tu período en números</h2><p>{statisticsRangeLabel(data.range)} · {data.days} {data.days === 1 ? "día" : "días"}</p></div></div>
        <div className="statistics-metrics">
          {([
            { key: "income", label: "Ingresos", icon: <ArrowDownLeft size={18} />, hint: "Ver ingresos" },
            { key: "expense", label: "Gastos", icon: <ArrowUpRight size={18} />, hint: "Ver gastos" },
            { key: "net", label: "Flujo neto", icon: null, hint: "Ver movimientos" },
            { key: "dailyExpense", label: "Gasto diario promedio", icon: null, hint: "Ver gastos" },
          ] as const).map(metric => <button key={metric.key} className={`statistics-metric ${metric.key}`} onClick={() => selectType(metric.key === "net" ? undefined : metric.key === "dailyExpense" ? "expense" : metric.key)}>
            <span>{metric.icon}{metric.label}</span>
            <strong>{money(data.current[metric.key])}</strong>
            <small>{metric.key === "net" ? "Ingresos menos gastos; no es el saldo disponible." : metric.key === "dailyExpense" ? `Gastos divididos entre ${data.days} días, incluidos los días sin gastos.` : comparisonLabel(data.current[metric.key], data.previous[metric.key], currency, data.comparisonAvailable)}</small>
            <span className="statistics-metric-link">{metric.hint}<ArrowRight size={15} /></span>
          </button>)}
        </div>
        <p className="statistics-note">Comparación: {statisticsRangeLabel(data.previous)}. Solo movimientos guardados, según su fecha.</p>
        {!data.comparisonAvailable && <p className="statistics-history-note">{data.firstDate ? `Tu primer movimiento registrado es del ${statisticsDate(data.firstDate, true)}. No hay suficiente historial anterior para una comparación completa.` : "Todavía no hay movimientos registrados en este bolsillo."}</p>}
      </section>

      {data.current.count === 0 ? <section className="state-card statistics-empty"><h2>No hay movimientos en este período</h2><p>Probá otras fechas o registrá un ingreso o un gasto desde Movimientos. Tus totales para este período son cero.</p></section> : <>
        <section className="statistics-section" aria-labelledby="statistics-trend-title">
          <div className="statistics-section-heading"><div><h2 id="statistics-trend-title">Ingresos y gastos en el tiempo</h2><p>Seleccioná una barra para ver los movimientos de esas fechas.</p></div><div className="field statistics-group-field"><label htmlFor="statistics-group">Agrupar por</label><select id="statistics-group" value={group} onChange={event => onGroupChange(event.target.value as StatisticsGroup)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></div></div>
          <div className="statistics-chart-legend"><span className="income"><ArrowDownLeft size={16} /> Ingresos</span><span className="expense"><ArrowUpRight size={16} /> Gastos</span><span>Escala en {currency} · máximo {money(maximum)}</span></div>
          <div className="statistics-chart-scroll" role="region" aria-label="Gráfico de ingresos y gastos; desplazá horizontalmente para ver todas las fechas" tabIndex={0}>
            <div className="statistics-chart" style={{ minWidth: Math.max(280, data.trend.length * 32) }}>
              <div className="statistics-chart-grid" aria-hidden="true"><span>{money(maximum)}</span><span>{money(maximum / 2)}</span><span>{money(0)}</span></div>
              <div className="statistics-chart-bars" style={{ gridTemplateColumns: `repeat(${data.trend.length}, minmax(0, 1fr))` }}>
                {data.trend.map(bucket => {
                  const label = `${statisticsRangeLabel(bucket)}: ingresos ${money(bucket.income)}, gastos ${money(bucket.expense)}`;
                  return <button key={bucket.start} className="statistics-chart-bucket" aria-label={`${label}. Ver movimientos.`} title={label} onClick={() => onSelect({ start: bucket.start, end: bucket.end, label: `Movimientos: ${statisticsRangeLabel(bucket)}` })}>
                    <span className="statistics-bar-pair" aria-hidden="true"><span className="statistics-bar income" style={{ height: `${bucket.income / maximum * 100}%` }} /><span className="statistics-bar expense" style={{ height: `${bucket.expense / maximum * 100}%` }} /></span>
                    <span className="statistics-bucket-label" aria-hidden="true">{statisticsDate(bucket.start)}</span>
                  </button>;
                })}
              </div>
            </div>
          </div>
          {data.trend.length > 10 && <p className="statistics-note">Si no ves todas las fechas, deslizá el gráfico hacia los lados o elegí agrupar por semana o mes.</p>}
          <details className="statistics-chart-table"><summary>Ver datos del gráfico en una tabla</summary><div><table><caption>Ingresos y gastos por {group === "day" ? "día" : group === "week" ? "semana" : "mes"}, en {currency}</caption><thead><tr><th scope="col">Período</th><th scope="col">Ingresos</th><th scope="col">Gastos</th></tr></thead><tbody>{data.trend.map(bucket => <tr key={bucket.start}><th scope="row"><button onClick={() => onSelect({ start: bucket.start, end: bucket.end, label: `Movimientos: ${statisticsRangeLabel(bucket)}` })}>{statisticsRangeLabel(bucket)}</button></th><td>{money(bucket.income)}</td><td>{money(bucket.expense)}</td></tr>)}</tbody></table></div></details>
        </section>

        <section className="statistics-section" aria-labelledby="statistics-tags-title">
          <div className="statistics-section-heading"><div><h2 id="statistics-tags-title">Tu dinero, por tags</h2><p>Explorá los movimientos detrás de cada grupo.</p></div><div className="statistics-type-picker" role="group" aria-label="Tipo de movimiento en el desglose"><button aria-pressed={breakdownType === "expense"} onClick={() => setBreakdownType("expense")}>Gastos</button><button aria-pressed={breakdownType === "income"} onClick={() => setBreakdownType("income")}>Ingresos</button></div></div>
          {breakdown.overlapping && <p className="statistics-note">Un movimiento puede tener varios tags y aparecer en más de una barra. Las barras no se suman; el total del período cuenta cada movimiento una sola vez.</p>}
          {breakdown.rows.length === 0 ? <p className="statistics-note">No hay {breakdownType === "expense" ? "gastos" : "ingresos"} en este período.</p> : <div className="statistics-breakdown">
            {breakdown.rows.map(row => {
              const tag = row.tagId ? tagsById.get(row.tagId) : undefined;
              const label = tag?.label ?? "Sin tags";
              return <button key={row.tagId ?? "untagged"} className={`statistics-tag-row tag-${tag?.color ?? "slate"}`} onClick={() => onSelect({ ...data.range, type: breakdownType, tagId: row.tagId, label: `${breakdownType === "expense" ? "Gastos" : "Ingresos"}: ${label}` })}>
                <span className="statistics-tag-copy"><strong>{label}</strong><span>{money(row.amount)}<ArrowRight size={16} /></span></span>
                <span className="statistics-tag-track" aria-hidden="true"><span style={{ width: `${row.amount / breakdown.rows[0].amount * 100}%` }} /></span>
                <small>{row.count} {row.count === 1 ? "movimiento" : "movimientos"}</small>
              </button>;
            })}
          </div>}
        </section>

        <section className="statistics-section" aria-labelledby="statistics-insights-title">
          <div className="statistics-section-heading"><div><h2 id="statistics-insights-title">Lo que muestran tus movimientos</h2><p>Observaciones sobre los registros de este período.</p></div></div>
          <ul className="statistics-insights">
            <li><button onClick={() => selectType()}><span><strong>{data.current.net > 0 ? "Registraste más ingresos que gastos" : data.current.net < 0 ? "Registraste más gastos que ingresos" : "Tus ingresos y gastos fueron iguales"}</strong><span>{data.current.net === 0 ? "El flujo neto del período es cero." : `La diferencia del período es de ${money(Math.abs(data.current.net))}.`} Esto no representa el saldo disponible del bolsillo.</span></span><ArrowRight size={18} /></button></li>
            {data.comparisonAvailable && (["expense", "income"] as const).map(type => <li key={type}><button onClick={() => selectType(type)}><span><strong>{type === "expense" ? "Gastos" : "Ingresos"} respecto al período anterior</strong><span>{comparisonLabel(data.current[type], data.previous[type], currency, true)}. Antes: {money(data.previous[type])}; ahora: {money(data.current[type])}.</span></span><ArrowRight size={18} /></button></li>)}
            {topExpense && <li><button onClick={() => onSelect({ ...data.range, type: "expense", tagId: topExpense.tagId, label: `Gastos: ${topExpense.tagId ? tagsById.get(topExpense.tagId)?.label ?? "Sin tags" : "Sin tags"}` })}><span><strong>{topExpense.tagId ? `${tagsById.get(topExpense.tagId)?.label}: el tag con más gastos` : "Tus gastos sin tags"}</strong><span>{money(topExpense.amount)} en {topExpense.count} {topExpense.count === 1 ? "movimiento" : "movimientos"}.{data.breakdown.expense.overlapping ? " Este monto puede aparecer también en otros tags." : ""}</span></span><ArrowRight size={18} /></button></li>}
            {largestBucket && largestBucket.expense > 0 && <li><button onClick={() => onSelect({ start: largestBucket.start, end: largestBucket.end, type: "expense", label: `Gastos: ${statisticsRangeLabel(largestBucket)}` })}><span><strong>{group === "day" ? "El día" : group === "week" ? "La semana" : "El mes"} con más gastos en el período</strong><span>{statisticsRangeLabel(largestBucket)} · {money(largestBucket.expense)}.{group !== "day" ? " Las fechas de los extremos pueden cubrir solo parte de la semana o del mes." : ""}</span></span><ArrowRight size={18} /></button></li>}
          </ul>
        </section>
      </>}
    </div>
  );
}
