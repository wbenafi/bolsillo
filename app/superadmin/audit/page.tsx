"use client";

import { usePaginatedQuery } from "convex/react";
import { ScrollText } from "lucide-react";

import { LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";

export default function AuditPage() {
  const audit = usePaginatedQuery(api.superadmin.listAuditLog, {}, { initialNumItems: 30 });
  return (
    <main className="admin-page">
      <section className="page-heading"><p className="eyebrow">Trazabilidad</p><h2>Auditoría</h2><p>Cambios administrativos ordenados del más reciente al más antiguo.</p></section>
      <section className="admin-panel">
        {audit.status === "LoadingFirstPage" ? <LoadingState label="Cargando actividad…" /> : audit.results.length === 0 ? <div className="admin-empty"><ScrollText /><h3>Sin actividad</h3><p>Los cambios de cuentas, roles y funciones aparecerán acá.</p></div> : <div className="audit-table">{audit.results.map((entry) => <article key={entry._id}><time>{new Intl.DateTimeFormat("es-CR", { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt)}</time><div><strong>{entry.summary}</strong><small>{entry.actor?.name ?? entry.actor?.email ?? entry.actor?.externalId ?? "Usuario eliminado"}</small></div><code>{entry.action}</code></article>)}</div>}
        {audit.status === "CanLoadMore" && <button className="button secondary load-more" type="button" onClick={() => audit.loadMore(30)}>Cargar más actividad</button>}
        {audit.status === "LoadingMore" && <LoadingState label="Cargando más…" />}
      </section>
    </main>
  );
}
