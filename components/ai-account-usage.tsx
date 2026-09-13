"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const statusLabels: Record<string, string> = { queued: "En espera", processing: "Leyendo", ready: "Completado", failed: "Error", cancelled: "Cancelado" };
export function AIAccountUsage({ accountId }: { accountId: Id<"accounts"> }) {
  const data = useQuery(api.transactionExtractions.adminUsage, { accountId });
  if (!data) return null;
  const usage = data.current;
  return <section className="admin-section"><div className="admin-section-heading"><div><p className="eyebrow">qwen3.8-flash · {data.month}</p><h3>Lectura de comprobantes</h3></div><p>El cupo se renueva el primer día de cada mes a las 00:00 UTC.</p></div>
    <div className="ai-usage-grid"><div><strong>{usage?.used ?? 0}</strong><span>Análisis enviados · {usage?.reserved ?? 0} en espera</span></div><div><strong>{usage?.errors ?? 0}</strong><span>Errores</span></div><div><strong>{((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)).toLocaleString("es-CR")}</strong><span>Tokens registrados</span></div><div><strong>{usage?.pricedCalls ? `$${usage.costUsd.toFixed(4)}` : "—"}</strong><span>Costo estimado USD</span></div></div>
    <p className="receipt-help">Cada solicitud enviada al proveedor consume un análisis, incluso si falla o se cancela. Los errores previos al envío no consumen cupo. Los costos requieren configurar las tarifas del proveedor; los registros no incluyen imágenes ni datos del comprobante.</p>
    {!!data.recent.length && <div className="ai-usage-table"><table><caption className="receipt-help">Últimos 30 análisis · Registros disponibles durante 30 días</caption><thead><tr><th>Fecha</th><th>Estado</th><th>Duración</th><th>Tokens entrada / salida</th><th>Error</th></tr></thead><tbody>{data.recent.map(job => <tr key={job._id}><td>{new Date(job.createdAt).toLocaleString("es-CR")}</td><td>{statusLabels[job.status]}</td><td>{job.durationMs !== undefined ? `${(job.durationMs / 1000).toFixed(1)} s` : "—"}</td><td>{job.inputTokens ?? "—"} / {job.outputTokens ?? "—"}</td><td>{job.errorCode ?? "—"}</td></tr>)}</tbody></table></div>}
  </section>;
}
