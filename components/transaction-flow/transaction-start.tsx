import {
  ArrowRight,
  Check,
  LoaderCircle,
  PencilLine,
  ReceiptText,
} from "lucide-react";
import { ReceiptDocuments } from "@/components/receipt-documents";
import { extractionErrors } from "@/lib/transaction-extraction";
import type { TransactionDraftController } from "./use-transaction-draft";
import type { ReceiptExtractionController } from "./use-receipt-extraction";

export function TransactionStart({
  draft,
  receipt,
  canRead,
  canFiles,
  disabled,
  onManual,
  onContinue,
}: {
  draft: TransactionDraftController;
  receipt: ReceiptExtractionController;
  canRead: boolean;
  canFiles: boolean;
  disabled: boolean;
  onManual: () => void;
  onContinue: () => void;
}) {
  return (
    <section aria-labelledby="movement-start-heading">
      <h2 id="movement-start-heading">¿Cómo querés empezar?</h2>
      <p className="movement-help">
        {canRead
          ? "Ingresá los datos o completalos con un comprobante."
          : "Ingresá los datos de tu movimiento."}
      </p>
      <button
        type="button"
        className="movement-manual-entry"
        onClick={onManual}
        disabled={disabled}
        aria-labelledby="movement-manual-label"
        aria-describedby="movement-manual-help"
      >
        <PencilLine size={23} />
        <span>
          <strong id="movement-manual-label">Completar manualmente</strong>
          <small id="movement-manual-help">
            {canFiles
              ? "Ingresá los datos. Podés adjuntar archivos después."
              : "Ingresá el monto, la descripción y la fecha."}
          </small>
        </span>
        <ArrowRight size={21} />
      </button>
      {canRead && (
        <div className="movement-receipt-entry">
          <h3>Completar desde un comprobante</h3>
          <p className="movement-help">
            Elegí los archivos del comprobante. La lectura empieza cuando la
            solicitás.
          </p>
          <ReceiptDocuments
            draftId={draft.draftId}
            files={draft.state.files}
            selected={draft.state.selectedFileIds}
            disabled={disabled || receipt.analyzing}
            uploading={draft.operation === "upload"}
            onAdd={(files) => {
              void draft.addFiles(files, true);
            }}
            onRemove={(id) =>
              draft.change((previous) => ({
                ...previous,
                files: previous.files.filter((file) => file._id !== id),
                selectedFileIds: previous.selectedFileIds.filter(
                  (fileId) => fileId !== id,
                ),
                reviewedFields: previous.selectedFileIds.includes(id)
                  ? []
                  : previous.reviewedFields,
              }))
            }
            onSelect={(selectedFileIds) =>
              draft.change((previous) => ({
                ...previous,
                selectedFileIds,
                reviewedFields: [],
              }))
            }
          />
          <div className="receipt-analyze">
            {receipt.usable ? (
              <button
                type="button"
                className="button secondary"
                onClick={onContinue}
                disabled={disabled}
              >
                <Check size={18} /> Continuar con los datos
              </button>
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  void receipt.analyze();
                }}
                disabled={
                  disabled ||
                  receipt.analyzing ||
                  !draft.state.selectedFileIds.length ||
                  receipt.limitReached
                }
              >
                {receipt.analyzing ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ReceiptText size={18} />
                )}
                {receipt.analyzing
                  ? "Leyendo tu comprobante…"
                  : "Completar con este comprobante"}
              </button>
            )}
            {receipt.result && (
              <button
                type="button"
                className="receipt-text-button"
                disabled={disabled || receipt.analyzing || receipt.limitReached}
                onClick={() => {
                  void receipt.analyze(true);
                }}
              >
                Volver a leer · usa otra lectura
              </button>
            )}
            <p className="receipt-help" role="status">
              {receipt.analyzing
                ? "La lectura está en curso. Podés seguir manualmente."
                : "Usamos IA para sugerir datos. Vos los revisás antes de registrar."}
            </p>
            {receipt.limitReached && !receipt.analyzing && (
              <p className="receipt-notice">
                Usaste las {receipt.usage?.limit} lecturas de este mes. Podés
                seguir manualmente.
              </p>
            )}
            {receipt.job?.status === "failed" && (
              <p className="receipt-notice" role="alert">
                {extractionErrors[receipt.job.errorCode ?? "unavailable"] ??
                  extractionErrors.unavailable}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
