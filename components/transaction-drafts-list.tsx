"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Clock3, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { MovementConfirmDialog } from "@/components/transaction-flow/movement-confirm-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatMoney, getTransactionSign, parseMoneyInput } from "@/lib/money";
import type { Currency } from "@/types/domain";

export function TransactionDraftsList({
  walletId,
  currency,
  view = "summary",
  onOpen,
}: {
  walletId: Id<"wallets">;
  currency: Currency;
  view?: "summary" | "list";
  onOpen?: () => void;
}) {
  const drafts = useQuery(api.transactionDrafts.list, { walletId });
  const discard = useMutation(api.transactionDrafts.discard);
  const [target, setTarget] = useState<{
    id: Id<"transactionDrafts">;
    description: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  if (drafts === undefined)
    return view === "list" ? (
      <p className="movement-help" role="status">
        Recuperando pendientes…
      </p>
    ) : null;
  if (view === "summary")
    return drafts.length ? (
      <div className="movement-draft-nudge">
        <div>
          <strong>
            {drafts.length === 1
              ? "Tenés un movimiento por terminar"
              : `Tenés ${drafts.length} movimientos por terminar`}
          </strong>
          <small>Los borradores no cambian tu saldo.</small>
        </div>
        <button type="button" className="movement-text-button" onClick={onOpen}>
          Continuar <ArrowRight size={17} />
        </button>
      </div>
    ) : null;
  async function remove() {
    if (!target || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await discard({ draftId: target.id });
      setTarget(undefined);
      toast.success("Borrador descartado. El saldo no cambió.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {drafts.length ? (
        <ul className="movement-drafts-list">
          {drafts.map((draft) => {
            const amount = parseMoneyInput(draft.amount, currency);
            return (
              <li key={draft._id}>
                <Clock3 size={20} aria-hidden="true" />
                <Link
                  href={`/wallets/${walletId}/transactions/${draft.transactionId ? `${draft.transactionId}/edit` : "new"}?draft=${draft._id}`}
                >
                  <strong>
                    {draft.description || "Movimiento sin completar"}
                  </strong>
                  <small>
                    {draft.transactionId
                      ? "Edición pendiente"
                      : "Nuevo movimiento"}{" "}
                    · {draft.files} {draft.files === 1 ? "archivo" : "archivos"}
                  </small>
                  <small>
                    Disponible hasta{" "}
                    {new Date(draft.expiresAt).toLocaleString("es-CR", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                  <span>
                    {amount
                      ? `${getTransactionSign(draft.type)}${formatMoney(amount, currency)}`
                      : "Sin monto"}{" "}
                    · Continuar
                  </span>
                </Link>
                <button
                  className="movement-icon-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMessage(undefined);
                    setTarget({
                      id: draft._id,
                      description: draft.description,
                    });
                  }}
                  aria-label={`Descartar ${draft.description || "borrador"}`}
                >
                  <X size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-movements">
          <h3>Estás al día</h3>
          <p>Los movimientos que dejés para después aparecerán aquí.</p>
          <Link
            className="button secondary"
            href={`/wallets/${walletId}/transactions/new`}
          >
            Agregar movimiento
          </Link>
        </div>
      )}
      {target && (
        <MovementConfirmDialog
          title="¿Descartar este borrador?"
          confirmLabel="Descartar borrador"
          busy={busy}
          error={message}
          onClose={() => setTarget(undefined)}
          onConfirm={() => {
            void remove();
          }}
        >
          <p>
            Se eliminarán los datos pendientes y los archivos nuevos de «
            {target.description || "Movimiento sin completar"}». El saldo y los
            movimientos registrados se conservan.
          </p>
        </MovementConfirmDialog>
      )}
    </>
  );
}
