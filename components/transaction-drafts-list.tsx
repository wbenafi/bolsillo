"use client";
import { useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";

export function TransactionDraftsList({ walletId }: { walletId: Id<"wallets"> }) {
  const drafts = useQuery(api.transactionDrafts.list, { walletId });
  const discard = useMutation(api.transactionDrafts.discard);
  if (!drafts?.length) return null;
  async function remove(draftId: Id<"transactionDrafts">) {
    if (!window.confirm("¿Descartar este borrador y sus archivos nuevos?")) return;
    try { await discard({ draftId }); toast.success("Borrador descartado"); } catch (error) { toast.error(errorMessage(error)); }
  }
  return <details className="receipt-drafts" open><summary>{drafts.length === 1 ? "Tenés un movimiento por terminar" : `Tenés ${drafts.length} movimientos por terminar`}</summary><ul>{drafts.map(draft => <li key={draft._id}><Link href={`/wallets/${walletId}/transactions/${draft.transactionId ? `${draft.transactionId}/edit` : "new"}?draft=${draft._id}`}>{draft.description || "Movimiento sin completar"}<small>{draft.files} {draft.files === 1 ? "archivo" : "archivos"} · Retomá antes de {new Date(draft.expiresAt).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></Link><button className="icon-link" type="button" onClick={() => void remove(draft._id)} aria-label={`Descartar ${draft.description || "borrador"}`}><X size={17} /></button></li>)}</ul></details>;
}
