"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, PencilLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TagChip } from "@/components/tag-chip";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import { formatTransactionDate } from "@/lib/date";
import { errorMessage } from "@/lib/errors";
import { formatMoney, getTransactionSign } from "@/lib/money";
import { transactionImpact } from "@/lib/transaction-flow";
import type { WalletSummary, WalletTransaction } from "@/types/domain";
import { MovementConfirmDialog } from "./movement-confirm-dialog";
import { TransactionAttachments } from "./transaction-attachments";

export function TransactionDetail({
  wallet,
  transaction,
  onDeleting,
}: {
  wallet: WalletSummary;
  transaction: WalletTransaction;
  onDeleting: (value: boolean) => void;
}) {
  const router = useRouter();
  const canManage = useFeature("transactions.manage");
  const canFiles = useFeature("transactions.files");
  const editable = canManage && !wallet.archivedAt;
  const tags = useQuery(api.tags.listTagsByWallet, { walletId: wallet._id });
  const drafts = useQuery(
    api.transactionDrafts.list,
    editable ? { walletId: wallet._id } : "skip",
  );
  const remove = useMutation(api.transactions.deleteTransaction);
  const [target, setTarget] = useState<WalletTransaction>();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string>();
  const locked = useRef(false);
  const pending = drafts?.find(
    (draft) => draft.transactionId === transaction._id,
  );
  const selectedTags =
    tags?.filter((tag) => transaction.tagIds?.includes(tag._id)) ?? [];
  const walletHref = `/wallets/${wallet._id}`;
  const editHref = `${walletHref}/transactions/${transaction._id}/edit`;

  async function confirmDelete() {
    if (!target || !editable || locked.current) return;
    locked.current = true;
    setDeleting(true);
    setMessage(undefined);
    onDeleting(true);
    try {
      await remove({
        transactionId: target._id,
        expectedRevision: target.revision ?? 0,
      });
      toast.success("Movimiento eliminado. Saldo actualizado.");
      router.replace(walletHref);
    } catch (error) {
      setMessage(errorMessage(error));
      setDeleting(false);
      locked.current = false;
      onDeleting(false);
    }
  }

  return (
    <article className="movement-detail">
      <div className="movement-editor-top">
        <Link className="movement-text-button" href={walletHref}>
          <ArrowLeft size={18} /> {wallet.name}
        </Link>
        <span className="movement-recorded">Registrado</span>
      </div>
      {pending && (
        <div className="movement-draft-notice">
          <p>
            Conservás un borrador de edición anterior. Estos son los datos
            registrados.
          </p>
          <Link
            className="movement-text-button"
            href={`${editHref}?draft=${pending._id}`}
          >
            Recuperar edición anterior{" "}
            <ArrowLeft size={16} className="movement-forward-icon" />
          </Link>
        </div>
      )}
      <div className="movement-detail-heading">
        <header className="movement-heading">
          <h1>{transaction.description}</h1>
          <p>
            {transaction.type === "income" ? "Ingreso" : "Gasto"} ·{" "}
            {wallet.name}
          </p>
        </header>
        {editable && (
          <Link
            className="button secondary"
            href={editHref}
            aria-label="Editar movimiento"
          >
            <PencilLine size={18} /> Editar
          </Link>
        )}
      </div>
      <p className={`movement-detail-amount ${transaction.type}`}>
        {getTransactionSign(transaction.type)}
        {formatMoney(transaction.amountMinor, wallet.currency)}
      </p>
      <p className="movement-help">
        {formatTransactionDate(transaction.date)} · {wallet.currency}
      </p>
      <dl className="movement-definition">
        <div>
          <dt>Fecha</dt>
          <dd>{formatTransactionDate(transaction.date)}</dd>
        </div>
        <div>
          <dt>Etiquetas</dt>
          <dd>
            {tags === undefined
              ? "Cargando etiquetas…"
              : selectedTags.length
                ? selectedTags.map((tag) => <TagChip key={tag._id} tag={tag} />)
                : "Sin etiquetas"}
          </dd>
        </div>
        <div>
          <dt>Notas</dt>
          <dd>{transaction.notes || "Sin notas"}</dd>
        </div>
      </dl>
      {canFiles && (
        <TransactionAttachments
          files={transaction.files ?? []}
          sourceFileIds={transaction.receiptFileIds}
        />
      )}
      <div className="movement-current-balance">
        <span>Saldo actual del bolsillo</span>
        <strong>{formatMoney(wallet.balance, wallet.currency)}</strong>
      </div>
      {!editable && (
        <p className="movement-help">
          {wallet.archivedAt
            ? "Bolsillo archivado. Restauralo para modificar movimientos."
            : "Modo consulta. Tus movimientos y archivos se conservan."}
        </p>
      )}
      {editable && (
        <details className="movement-more-actions">
          <summary>Más acciones</summary>
          <button
            type="button"
            className="movement-text-button destructive"
            disabled={deleting}
            onClick={() => {
              setMessage(undefined);
              setTarget(transaction);
            }}
          >
            <Trash2 size={18} /> Eliminar movimiento
          </button>
        </details>
      )}
      {target && (
        <MovementConfirmDialog
          title="¿Eliminar este movimiento?"
          confirmLabel="Eliminar definitivamente"
          busy={deleting}
          error={message}
          onClose={() => setTarget(undefined)}
          onConfirm={() => {
            void confirmDelete();
          }}
        >
          <p>
            Se eliminará «{target.description}» por{" "}
            {formatMoney(target.amountMinor, wallet.currency)}
            {target.fileCount
              ? ` y sus ${target.fileCount} archivos adjuntos`
              : ""}
            .
          </p>
          <p>
            El saldo pasará de {formatMoney(wallet.balance, wallet.currency)} a{" "}
            {formatMoney(
              transactionImpact(wallet.balance, "income", 0, target).balance,
              wallet.currency,
            )}
            . Esta acción es permanente.
          </p>
        </MovementConfirmDialog>
      )}
    </article>
  );
}
