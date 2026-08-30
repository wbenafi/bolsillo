"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Archive, CheckCircle2, DatabaseZap, Search, ShieldCheck, Users, WalletCards } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

export default function SuperadminPage() {
  const overview = useQuery(api.superadmin.overview);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const deferredSearch = useDeferredValue(search);
  const accounts = usePaginatedQuery(
    api.superadmin.listAccounts,
    {
      search: deferredSearch.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    },
    { initialNumItems: 20 },
  );
  const backfill = useMutation(api.superadmin.backfillLegacyWalletOwners);
  const [backfilling, setBackfilling] = useState(false);

  async function runBackfill() {
    setBackfilling(true);
    try {
      const result = await backfill({});
      toast.success(result.walletCount
        ? `Se migraron ${result.ownerCount} propietarios.`
        : "Todos los bolsillos ya están vinculados a cuentas.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <main className="admin-page">
      <section className="page-heading split admin-heading">
        <div><p className="eyebrow">Directorio operativo</p><h2>Cuentas</h2><p>Usuarios, bolsillos y acceso a funciones desde un solo lugar.</p></div>
        {overview && overview.legacyWalletCount > 0 && (
          <button type="button" className="button secondary" onClick={runBackfill} disabled={backfilling}>
            <DatabaseZap /> {backfilling ? "Migrando…" : `Migrar ${overview.legacyWalletCount} bolsillos`}
          </button>
        )}
      </section>

      {overview === undefined ? <LoadingState label="Calculando el estado de la plataforma…" /> : (
        <section className="admin-stats" aria-label="Resumen de plataforma">
          <article><Users /><span>Cuentas</span><strong>{overview.accountCount}</strong><small>{overview.suspendedAccountCount} suspendidas</small></article>
          <article><CheckCircle2 /><span>Activas</span><strong>{overview.activeAccountCount}</strong><small>con acceso a Bolsillo</small></article>
          <article><WalletCards /><span>Bolsillos</span><strong>{overview.walletCount}</strong><small>{overview.legacyWalletCount} pendientes de migrar</small></article>
          <article><ShieldCheck /><span>Superadmins</span><strong>{overview.superadminCount}</strong><small>{overview.userCount} usuarios registrados</small></article>
        </section>
      )}

      <section className="admin-panel">
        <div className="admin-toolbar">
          <label className="admin-search"><Search /><span className="sr-only">Buscar cuentas</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, correo o Clerk ID" /></label>
          <label className="admin-filter"><span className="sr-only">Filtrar por estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todos los estados</option><option value="active">Activas</option><option value="suspended">Suspendidas</option></select></label>
        </div>

        {accounts.status === "LoadingFirstPage" ? <LoadingState label="Buscando cuentas…" /> : accounts.results.length === 0 ? (
          <div className="admin-empty"><Users /><h3>No encontramos cuentas</h3><p>Probá con otra búsqueda o filtro.</p></div>
        ) : (
          <div className="account-list">
            {accounts.results.map((account) => (
              <Link href={`/superadmin/accounts/${account._id}`} key={account._id} className="account-row">
                <div className="account-identity">
                  {account.owner?.imageUrl ? <Image src={account.owner.imageUrl} alt="" width={44} height={44} unoptimized /> : <span>{(account.owner?.name ?? account.name).slice(0, 1).toLocaleUpperCase("es")}</span>}
                  <div><strong>{account.owner?.name ?? account.name}</strong><small>{account.owner?.email ?? account.owner?.externalId ?? "Sin identidad vinculada"}</small></div>
                </div>
                <div className="account-metrics"><span><WalletCards /> {account.walletCount}</span>{account.activeWalletCount !== account.walletCount && <span><Archive /> {account.walletCount - account.activeWalletCount}</span>}</div>
                <span className={`status-badge ${account.status}`}>{account.status === "active" ? "Activa" : "Suspendida"}</span>
              </Link>
            ))}
          </div>
        )}
        {accounts.status === "CanLoadMore" && <button className="button secondary load-more" type="button" onClick={() => accounts.loadMore(20)}>Cargar más cuentas</button>}
        {accounts.status === "LoadingMore" && <div className="load-more"><LoadingState label="Cargando más…" /></div>}
      </section>
    </main>
  );
}
