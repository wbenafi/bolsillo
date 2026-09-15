import { PencilLine } from "lucide-react";
import { TagChip } from "@/components/tag-chip";
import { formatTransactionDate } from "@/lib/date";
import { formatMoney, getTransactionSign, parseMoneyInput } from "@/lib/money";
import type {
  Currency,
  WalletTag,
  WalletTransaction,
  TransactionAttachment,
} from "@/types/domain";
import type { TransactionEditorState } from "./types";
import type { Id } from "@/convex/_generated/dataModel";
import { TransactionAttachments } from "./transaction-attachments";

export function TransactionConfirmation({
  state,
  currency,
  tags,
  original,
  draftId,
  sourceFileIds,
  canFiles,
  disabled,
  onBack,
}: {
  state: TransactionEditorState<TransactionAttachment>;
  currency: Currency;
  tags: WalletTag[];
  original?: WalletTransaction;
  draftId?: Id<"transactionDrafts">;
  sourceFileIds: Id<"transactionFiles">[];
  canFiles: boolean;
  disabled: boolean;
  onBack: () => void;
}) {
  const selectedTags = tags.filter((tag) =>
    state.values.tagIds.includes(tag._id),
  );
  return (
    <section aria-labelledby="confirmation-heading">
      <h2 id="confirmation-heading">
        {original ? "Revisá tus cambios" : "Revisá antes de registrar"}
      </h2>
      <p className="movement-help">
        {original
          ? "El movimiento original se actualiza al guardar los cambios."
          : "Esta confirmación agrega el movimiento al saldo del bolsillo."}
      </p>
      <p className={`movement-detail-amount ${state.values.type}`}>
        {getTransactionSign(state.values.type)}
        {formatMoney(
          parseMoneyInput(state.values.amount, currency) ?? 0,
          currency,
        )}
      </p>
      <h3 className="movement-description">{state.values.description}</h3>
      <dl className="movement-definition">
        <div>
          <dt>Tipo</dt>
          <dd>{state.values.type === "income" ? "Ingreso" : "Gasto"}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{formatTransactionDate(state.values.date)}</dd>
        </div>
        <div>
          <dt>Etiquetas</dt>
          <dd>
            {selectedTags.length
              ? selectedTags.map((tag) => <TagChip key={tag._id} tag={tag} />)
              : "Sin etiquetas"}
          </dd>
        </div>
        <div>
          <dt>Notas</dt>
          <dd>{state.values.notes || "Sin notas"}</dd>
        </div>
        {original && (
          <div>
            <dt>Monto anterior</dt>
            <dd>
              {getTransactionSign(original.type)}
              {formatMoney(original.amountMinor, currency)}
            </dd>
          </div>
        )}
      </dl>
      {canFiles ? (
        <TransactionAttachments
          files={state.files}
          draftId={draftId}
          sourceFileIds={sourceFileIds}
        />
      ) : (
        state.files.length > 0 && (
          <p className="movement-help">
            Los archivos existentes se conservan. La gestión de adjuntos está
            deshabilitada para esta cuenta.
          </p>
        )
      )}
      <button
        type="button"
        className="movement-text-button"
        onClick={onBack}
        disabled={disabled}
      >
        <PencilLine size={18} /> Volver a los datos
      </button>
    </section>
  );
}
