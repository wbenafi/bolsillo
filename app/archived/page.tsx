"use client";

import { useMutation, useQuery } from "convex/react";
import { ArchiveRestore, ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { LoadingState } from "@/components/ui-states";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import type { WalletSummary } from "@/types/domain";

export default function ArchivedPage() {
  const wallets = useQuery(api.wallets.listArchivedWallets) as WalletSummary[] | undefined;
  const restoreWallet = useMutation(api.wallets.restoreWallet);
  const deleteWallet = useMutation(api.wallets.deleteWallet);
  const canActivateWallets = useFeature("wallets.create");
  async function restore(wallet: WalletSummary) { try { await restoreWallet({ walletId: wallet._id }); toast.success("Bolsillo restaurado"); } catch (error) { toast.error(errorMessage(error)); } }
  async function remove(wallet: WalletSummary) { if (!window.confirm(`¿Eliminar definitivamente “${wallet.name}”?\nTambién se eliminarán todos sus movimientos y archivos adjuntos.`)) return; try { await deleteWallet({ walletId: wallet._id }); toast.success("Bolsillo eliminado"); } catch (error) { toast.error(errorMessage(error)); } }
  return <main className="page-shell"><Link className="back-link" href="/"><ArrowLeft /> Bolsillos</Link><section className="page-heading"><p className="eyebrow">Fuera de la vista principal</p><h1>Bolsillos archivados</h1><p>Restauralos cuando vuelvas a necesitarlos.</p></section>{wallets === undefined ? <LoadingState /> : wallets.length === 0 ? <div className="state-card"><h2>No hay bolsillos archivados</h2><p>Cuando archivés uno, aparecerá acá.</p></div> : <div className="archived-list">{wallets.map((wallet) => <article key={wallet._id}><Link href={`/wallets/${wallet._id}`}><div><h2>{wallet.name}</h2><p>{wallet.description ?? "Sin descripción"}</p></div><strong>{formatMoney(wallet.balance, wallet.currency)}</strong></Link><div>{canActivateWallets && <button className="button secondary" onClick={() => restore(wallet)}><ArchiveRestore /> Restaurar</button>}<button className="icon-link destructive" onClick={() => remove(wallet)} aria-label={`Eliminar ${wallet.name}`}><Trash2 /></button></div></article>)}</div>}</main>;
}
