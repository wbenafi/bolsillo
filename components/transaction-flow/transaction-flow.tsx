"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import {
  matchingReceiptTags,
  transactionImpact,
  validateTransaction,
  type TransactionErrors,
  type TransactionStep,
} from "@/lib/transaction-flow";
import type { ExtractionField } from "@/lib/transaction-extraction";
import type { TransactionFormValues } from "@/lib/validators";
import { MovementConfirmDialog } from "./movement-confirm-dialog";
import { TransactionAttachments } from "./transaction-attachments";
import { TransactionConfirmation } from "./transaction-confirmation";
import { TransactionFields } from "./transaction-fields";
import { TransactionStart } from "./transaction-start";
import { TransactionStepper } from "./transaction-stepper";
import type { SavedTransactionDraft, TransactionFormProps } from "./types";
import { useReceiptExtraction } from "./use-receipt-extraction";
import { useTransactionDraft } from "./use-transaction-draft";

export function TransactionFlow(
  props: TransactionFormProps & { initialDraft?: SavedTransactionDraft },
) {
  const { wallet, transaction, initialDraft } = props;
  const router = useRouter();
  const canFiles = useFeature("transactions.files");
  const canAI = useFeature("transactions.aiExtract");
  const canRead = canFiles && canAI;
  const tags = useQuery(api.tags.listTagsByWallet, { walletId: wallet._id });
  const draft = useTransactionDraft(props);
  const [step, setStep] = useState<TransactionStep>(
    transaction || initialDraft ? 2 : 1,
  );
  const [errors, setErrors] = useState<TransactionErrors>({});
  const [checking, setChecking] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [confirmingBalance, setConfirmingBalance] = useState<number>();
  const [discardOpen, setDiscardOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const onReceiptReady = useCallback(() => setStep(2), []);
  const receipt = useReceiptExtraction(draft, canRead, tags, onReceiptReady);
  const unavailable =
    draft.remote === null || draft.currency !== wallet.currency;
  const disabled = draft.busy || checking || navigating || unavailable;
  const sourceFileIds = receipt.usable
    ? (receipt.job?.fileIds ?? [])
    : (transaction?.receiptFileIds ?? []);
  const source = canFiles
    ? draft.state.files.find((file) => sourceFileIds.includes(file._id))
    : undefined;
  const amountMinor = parseMoneyInput(
    draft.state.values.amount,
    draft.currency,
  );
  const impact = amountMinor
    ? transactionImpact(
        wallet.balance,
        draft.state.values.type,
        amountMinor,
        transaction,
      )
    : undefined;
  const walletHref = `/wallets/${wallet._id}`;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  // Links in app chrome must finish saving the editor before navigating away.
  // A hard reload/close is protected separately by the draft's beforeunload guard.
  useEffect(() => {
    function followLink(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (
        target.origin !== window.location.origin ||
        target.href === window.location.href ||
        target.hash
      )
        return;
      if (!draft.hasChanges && !draft.pendingUpload && !draft.busy) return;
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      void draft.leave().then((saved) => {
        if (saved) router.push(target.pathname + target.search);
      });
    }
    function saveOnHistoryNavigation() {
      if (draft.hasChanges && !draft.busy)
        void draft.flush().catch(() => undefined);
    }
    document.addEventListener("click", followLink, true);
    window.addEventListener("popstate", saveOnHistoryNavigation);
    return () => {
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("popstate", saveOnHistoryNavigation);
    };
  }, [disabled, draft, router]);

  function setField<K extends keyof TransactionFormValues>(
    key: K,
    value: TransactionFormValues[K],
  ) {
    if (disabled) return;
    const field = key === "tagIds" ? "tags" : key;
    draft.change((previous) => ({
      ...previous,
      values: { ...previous.values, [key]: value },
      reviewedFields:
        key === "amount"
          ? previous.reviewedFields.filter((item) => item !== "amount")
          : [...new Set([...previous.reviewedFields, field])],
    }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function keepField(key: ExtractionField) {
    if (disabled) return;
    if (
      key === "amount" &&
      !parseMoneyInput(draft.state.values.amount, draft.currency)
    ) {
      setErrors(validateTransaction(draft.state.values, draft.currency));
      document.getElementById("amount")?.focus();
      return;
    }
    draft.change((previous) => ({
      ...previous,
      reviewedFields: [...new Set([...previous.reviewedFields, key])],
    }));
    if (key === "amount")
      setErrors((previous) => ({ ...previous, amount: undefined }));
  }

  function applyField(key: ExtractionField) {
    const result = receipt.usable;
    if (!result || disabled || (key === "amount" && result.currencyMismatch))
      return;
    const value = result.fields[key].value;
    if (value === null) return;
    if (key === "tags")
      setField("tagIds", matchingReceiptTags(value as string[], tags ?? []));
    else if (key === "type") setField(key, value as "income" | "expense");
    else setField(key, value as string);
  }

  function validate() {
    const next = validateTransaction(
      draft.state.values,
      draft.currency,
      receipt.needsAmountReview,
    );
    setErrors(next);
    if (!Object.keys(next).length) return true;
    setStep(2);
    window.setTimeout(
      () =>
        document
          .getElementById(
            (["amount", "description", "date", "notes"] as const).find(
              (key) => next[key],
            ) ?? "amount",
          )
          ?.focus(),
      0,
    );
    return false;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || step === 1) return;
    if (receipt.analyzing) {
      draft.setMessage(
        "Esperá a que termine la lectura o elegí seguir manualmente.",
      );
      return;
    }
    if (draft.pendingUpload) {
      draft.setMessage(
        "Reintentá la carga pendiente o elegí seguir sin esos archivos.",
      );
      return;
    }
    if (!validate()) return;
    if (step === 2) {
      setChecking(true);
      try {
        await draft.flush();
        setStep(3);
      } catch {
        /* Draft explains the failure without losing entered values. */
      } finally {
        setChecking(false);
      }
      return;
    }
    setConfirmingBalance(impact?.balance);
    const id = await draft.commit();
    if (id) {
      setNavigating(true);
      toast.success(
        transaction ? "Cambios guardados" : "Movimiento registrado",
      );
      router.replace(`${walletHref}/transactions/${id}`);
    } else setConfirmingBalance(undefined);
  }

  async function leave() {
    if (disabled && !unavailable) return;
    if (unavailable) {
      router.push(walletHref);
      return;
    }
    if (await draft.leave()) {
      setNavigating(true);
      router.push(walletHref);
    }
  }

  async function manually() {
    if (disabled) return;
    if (receipt.analyzing || draft.state.mode === "documents") {
      if (!(await receipt.completeManually())) return;
    }
    setStep(2);
    window.setTimeout(() => document.getElementById("amount")?.focus(), 0);
  }

  const status = !draft.connected
    ? "Sin conexión · Cambios pendientes"
    : draft.saveState === "error"
      ? "No se guardaron los cambios"
      : draft.saveState === "saving"
        ? "Guardando borrador…"
        : draft.saveState === "saved"
          ? "Borrador guardado"
          : draft.hasChanges
            ? "Cambios sin guardar"
            : initialDraft
              ? "Borrador recuperado"
              : "El saldo cambia al registrar";

  return (
    <div className="movement-flow">
      <div className="movement-editor-top">
        <button
          type="button"
          className="movement-text-button"
          onClick={() => {
            void leave();
          }}
          disabled={draft.busy || checking || navigating}
        >
          <ArrowLeft size={18} /> {wallet.name}
        </button>
        <span className="movement-save-status" role="status">
          {status}
        </span>
      </div>
      <header className="movement-heading">
        <h1 ref={heading} tabIndex={-1}>
          {transaction
            ? "Editar movimiento"
            : initialDraft
              ? "Continuar movimiento"
              : "Nuevo movimiento"}
        </h1>
        <p>
          {transaction
            ? "El movimiento original sigue vigente hasta guardar los cambios."
            : initialDraft
              ? "Retomá tus datos. Todavía no están incluidos en el saldo."
              : `${wallet.name} · ${draft.currency}`}
        </p>
      </header>
      <div className="form-card movement-form-card">
        <TransactionStepper
          step={step}
          disabled={disabled || receipt.analyzing}
          onBack={setStep}
        />
        {unavailable && (
          <div className="movement-error" role="alert">
            {draft.currency !== wallet.currency
              ? "La moneda del bolsillo cambió. Conservá estos datos como referencia y creá un nuevo borrador con el monto correcto."
              : "Este borrador venció o ya no está disponible. Tus datos siguen visibles como referencia."}
          </div>
        )}
        {!draft.connected && (
          <p className="movement-notice" role="status">
            No hay conexión. Mantené esta pantalla abierta para conservar tus
            cambios.
          </p>
        )}
        {initialDraft && (
          <p className="movement-draft-notice">
            {transaction ? "Edición pendiente" : "Borrador"} · Disponible hasta{" "}
            {new Date(initialDraft.expiresAt).toLocaleString("es-CR", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
        <form onSubmit={submit} noValidate aria-busy={disabled}>
          {step === 1 && (
            <TransactionStart
              draft={draft}
              receipt={receipt}
              canRead={canRead}
              canFiles={canFiles}
              disabled={disabled}
              onManual={() => {
                void manually();
              }}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <>
              {receipt.analyzing && (
                <div className="movement-notice" role="status">
                  La lectura está en curso. Tus cambios manuales se conservan.
                  <button
                    type="button"
                    className="movement-text-button"
                    onClick={() => {
                      void receipt.completeManually();
                    }}
                  >
                    Seguir manualmente
                  </button>
                </div>
              )}
              {receipt.usable?.duplicate && (
                <p className="movement-notice">
                  Hay un movimiento con monto y fecha similares. Revisá si ya lo
                  registraste.
                </p>
              )}
              <TransactionFields
                walletId={wallet._id}
                currency={draft.currency}
                state={draft.state}
                tags={tags ?? []}
                disabled={disabled}
                errors={errors}
                result={receipt.usable}
                needsAmountReview={receipt.needsAmountReview}
                source={source}
                draftId={draft.draftId}
                onField={setField}
                onReviewAmount={() => keepField("amount")}
                onApply={applyField}
                onKeep={keepField}
              />
              {canFiles ? (
                <TransactionAttachments
                  files={draft.state.files}
                  draftId={draft.draftId}
                  sourceFileIds={sourceFileIds}
                  disabled={disabled || !!draft.pendingUpload}
                  uploading={draft.operation === "upload"}
                  onAdd={(files) => {
                    void draft.addFiles(files);
                  }}
                  onRename={(id, displayName) =>
                    draft.change((previous) => ({
                      ...previous,
                      files: previous.files.map((file) =>
                        file._id === id
                          ? { ...file, displayName: displayName || undefined }
                          : file,
                      ),
                    }))
                  }
                  onRemove={(id) =>
                    draft.change((previous) => ({
                      ...previous,
                      files: previous.files.filter((file) => file._id !== id),
                      selectedFileIds: previous.selectedFileIds.filter(
                        (fileId) => fileId !== id,
                      ),
                      reviewedFields: previous.selectedFileIds.some(
                        (fileId) => fileId === id,
                      )
                        ? []
                        : previous.reviewedFields,
                    }))
                  }
                />
              ) : (
                draft.state.files.length > 0 && (
                  <p className="movement-help">
                    Tus archivos existentes se conservan. La gestión de adjuntos
                    está deshabilitada.
                  </p>
                )
              )}
            </>
          )}
          {step === 3 && (
            <TransactionConfirmation
              state={draft.state}
              currency={draft.currency}
              tags={tags ?? []}
              original={transaction}
              draftId={draft.draftId}
              sourceFileIds={sourceFileIds}
              canFiles={canFiles}
              disabled={disabled}
              onBack={() => setStep(2)}
            />
          )}
          {draft.message && (
            <div className="movement-error" role="alert">
              <p>{draft.message}</p>
              {draft.saveState === "error" && !draft.pendingUpload && (
                <button
                  type="button"
                  className="movement-text-button"
                  disabled={disabled}
                  onClick={() => {
                    void draft.flush().catch(() => undefined);
                  }}
                >
                  Reintentar guardado del borrador
                </button>
              )}
            </div>
          )}
          {draft.pendingUpload && (
            <div className="movement-upload-retry">
              <p>
                No se guardaron:{" "}
                {draft.pendingUpload.files.map((file) => file.name).join(", ")}.
              </p>
              <div className="movement-inline-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled || !canFiles}
                  onClick={() => {
                    void draft.retryUpload();
                  }}
                >
                  Reintentar carga
                </button>
                <button
                  type="button"
                  className="movement-text-button"
                  disabled={disabled}
                  onClick={draft.cancelUpload}
                >
                  Seguir sin estos archivos
                </button>
              </div>
            </div>
          )}
          <footer className="movement-save-footer">
            {step !== 1 && (
              <div className="movement-impact">
                <span>
                  {transaction
                    ? "Saldo al guardar cambios"
                    : "Saldo después de registrar"}
                </span>
                <strong>
                  {impact
                    ? formatMoney(
                        confirmingBalance ?? impact.balance,
                        draft.currency,
                      )
                    : "Ingresá el monto"}
                </strong>
              </div>
            )}
            <div className="movement-save-actions">
              <button
                type="button"
                className="button secondary"
                disabled={disabled}
                onClick={() => {
                  void leave();
                }}
              >
                Continuar después
              </button>
              {step !== 1 && (
                <button
                  type="submit"
                  className="button primary"
                  disabled={disabled || receipt.analyzing}
                >
                  {(draft.operation === "save" || checking || navigating) && (
                    <LoaderCircle size={18} className="spin" />
                  )}
                  {checking ? (
                    "Guardando borrador…"
                  ) : step === 2 ? (
                    <>
                      Revisar movimiento <ArrowRight size={18} />
                    </>
                  ) : transaction ? (
                    "Guardar cambios"
                  ) : (
                    "Confirmar y registrar"
                  )}
                </button>
              )}
            </div>
            <p className="movement-help">
              El borrador se conserva por 24 horas y no cambia el saldo.
            </p>
            {(draft.draftId || draft.hasChanges) && (
              <button
                type="button"
                className="movement-text-button"
                disabled={disabled}
                onClick={() => {
                  draft.setMessage(undefined);
                  setDiscardOpen(true);
                }}
              >
                Descartar borrador
              </button>
            )}
          </footer>
        </form>
      </div>
      {discardOpen && (
        <MovementConfirmDialog
          title="¿Descartar este borrador?"
          confirmLabel="Descartar borrador"
          busy={draft.busy}
          error={draft.message}
          onClose={() => setDiscardOpen(false)}
          onConfirm={() => {
            void draft.discardDraft().then((discarded) => {
              if (discarded) router.replace(walletHref);
            });
          }}
        >
          <p>
            {transaction
              ? "Se eliminarán los cambios pendientes y los archivos nuevos. El movimiento original se conserva."
              : "Se eliminarán los datos y los archivos de este borrador."}{" "}
            El saldo no cambiará.
          </p>
        </MovementConfirmDialog>
      )}
    </div>
  );
}
