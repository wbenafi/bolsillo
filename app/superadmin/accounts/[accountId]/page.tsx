"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Archive, Ban, Check, RotateCcw, ShieldCheck, ShieldOff, WalletCards } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

type FeatureRowProps = {
  accountId: Id<"accounts">;
  feature: {
    key: string;
    enabled: boolean;
    limit?: number;
    overridden: boolean;
  };
  definition: {
    name: string;
    description: string;
    supportsLimit: boolean;
  };
};

function FeatureRow({ accountId, feature, definition }: FeatureRowProps) {
  const setOverride = useMutation(api.superadmin.setFeatureOverride);
  const removeOverride = useMutation(api.superadmin.removeFeatureOverride);
  const [limit, setLimit] = useState(feature.limit?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function save(enabled = feature.enabled) {
    setSaving(true);
    try {
      await setOverride({
        accountId,
        featureKey: feature.key,
        enabled,
        limit: definition.supportsLimit && limit ? Number(limit) : undefined,
      });
      toast.success("Acceso actualizado");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await removeOverride({ accountId, featureKey: feature.key });
      setLimit("");
      toast.success("Acceso predeterminado restaurado");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="feature-row">
      <div><strong>{definition.name}</strong><p>{definition.description}</p>{feature.overridden && <small>Configuración personalizada</small>}</div>
      <div className="feature-controls">
        {definition.supportsLimit && <label>Límite<input aria-label={`Límite de ${definition.name}`} inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value.replace(/\D/g, ""))} placeholder="Sin límite" /></label>}
        <button type="button" className={`feature-toggle ${feature.enabled ? "enabled" : "disabled"}`} onClick={() => save(!feature.enabled)} disabled={saving} aria-label={`${feature.enabled ? "Deshabilitar" : "Habilitar"} ${definition.name}`}>
          {feature.enabled ? <><Check /> Habilitada</> : <><Ban /> Deshabilitada</>}
        </button>
        {definition.supportsLimit && <button type="button" className="icon-link" onClick={() => save()} disabled={saving} aria-label={`Guardar límite de ${definition.name}`}><Check /></button>}
        {feature.overridden && <button type="button" className="icon-link" onClick={reset} disabled={saving} aria-label={`Restaurar ${definition.name}`}><RotateCcw /></button>}
      </div>
    </article>
  );
}

export default function AccountDetailPage() {
  const { accountId: rawAccountId } = useParams<{ accountId: string }>();
  const accountId = rawAccountId as Id<"accounts">;
  const detail = useQuery(api.superadmin.getAccount, { accountId });
  const setStatus = useMutation(api.superadmin.setAccountStatus);
  const setRole = useMutation(api.superadmin.setPlatformRole);
  const [saving, setSaving] = useState(false);

  if (!detail) return <main className="admin-page"><LoadingState label="Cargando la cuenta…" /></main>;
  const currentDetail = detail;

  async function toggleStatus() {
    const suspending = currentDetail.account.status === "active";
    const reason = suspending ? window.prompt("Motivo de la suspensión")?.trim() : undefined;
    if (suspending && !reason) return;
    if (!suspending && !window.confirm("¿Reactivar esta cuenta?")) return;
    setSaving(true);
    try {
      await setStatus({ accountId, status: suspending ? "suspended" : "active", reason });
      toast.success(suspending ? "Cuenta suspendida" : "Cuenta reactivada");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleRole() {
    if (!currentDetail.owner) return;
    const promoting = currentDetail.owner.platformRole !== "superadmin";
    if (!window.confirm(promoting ? "¿Promover este usuario a superadmin?" : "¿Quitarle acceso de superadmin?")) return;
    setSaving(true);
    try {
      await setRole({ userId: currentDetail.owner._id, role: promoting ? "superadmin" : "member" });
      toast.success(promoting ? "Superadmin agregado" : "Acceso de superadmin eliminado");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="admin-page account-detail-page">
      <Link className="back-link" href="/superadmin"><ArrowLeft /> Todas las cuentas</Link>
      <section className="account-detail-header">
        <div className="account-detail-identity">
          {detail.owner?.imageUrl ? <Image src={detail.owner.imageUrl} alt="" width={64} height={64} unoptimized /> : <span>{(detail.owner?.name ?? detail.account.name).slice(0, 1).toLocaleUpperCase("es")}</span>}
          <div><p className="eyebrow">Cuenta personal</p><h2>{detail.owner?.name ?? detail.account.name}</h2><p>{detail.owner?.email ?? detail.owner?.externalId}</p></div>
        </div>
        <span className={`status-badge ${detail.account.status}`}>{detail.account.status === "active" ? "Activa" : "Suspendida"}</span>
      </section>
      {detail.account.suspendedReason && <div className="admin-notice"><Ban /> <div><strong>Cuenta suspendida</strong><p>{detail.account.suspendedReason}</p></div></div>}

      <section className="admin-actions-card">
        <div><h3>Controles de cuenta</h3><p>Los cambios se aplican inmediatamente y quedan registrados.</p></div>
        <div>
          <button type="button" className={`button ${detail.account.status === "active" ? "destructive" : "secondary"}`} onClick={toggleStatus} disabled={saving}>{detail.account.status === "active" ? <><Ban /> Suspender cuenta</> : <><Check /> Reactivar cuenta</>}</button>
          {detail.owner && <button type="button" className="button secondary" onClick={toggleRole} disabled={saving}>{detail.owner.platformRole === "superadmin" ? <><ShieldOff /> Quitar superadmin</> : <><ShieldCheck /> Hacer superadmin</>}</button>}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading"><div><p className="eyebrow">Entitlements</p><h3>Acceso a funciones</h3></div><p>Sin configuración personalizada, todas las funciones permanecen habilitadas.</p></div>
        <div className="feature-list">
          {detail.features.map((feature) => {
            const definition = detail.featureDefinitions.find(({ key }) => key === feature.key)!;
            return <FeatureRow key={`${feature.key}-${feature.enabled}-${feature.limit}-${feature.overridden}`} accountId={accountId} feature={feature} definition={definition} />;
          })}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading"><div><p className="eyebrow">Patrimonio registrado</p><h3>Bolsillos</h3></div><p>{detail.wallets.length} en total</p></div>
        {detail.wallets.length === 0 ? <div className="admin-empty"><WalletCards /><h3>Sin bolsillos</h3><p>Esta cuenta todavía no creó ningún bolsillo.</p></div> : (
          <div className="admin-wallet-list">
            {detail.wallets.map((wallet) => <article key={wallet._id}><div><strong>{wallet.name}</strong><small>{wallet.transactionCount} movimientos {wallet.archivedAt && <><Archive /> Archivado</>}</small></div><div><span>Disponible</span><strong>{formatMoney(wallet.balance, wallet.currency)}</strong></div></article>)}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section-heading"><div><p className="eyebrow">Trazabilidad</p><h3>Actividad reciente</h3></div><Link href="/superadmin/audit">Ver todo</Link></div>
        {detail.recentAudit.length === 0 ? <p className="muted-copy">Todavía no hay cambios administrativos para esta cuenta.</p> : <div className="audit-list">{detail.recentAudit.map((entry) => <article key={entry._id}><span>{new Intl.DateTimeFormat("es-CR", { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt)}</span><p>{entry.summary}</p></article>)}</div>}
      </section>
    </main>
  );
}
