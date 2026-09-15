"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import {
  transactionImpact,
  validateTransaction,
  type TransactionErrors,
  type TransactionStep,
} from "@/lib/transaction-flow";
import type { TransactionFormValues } from "@/lib/validators";
import type { WalletSummary, WalletTransaction } from "@/types/domain";
import { MovementConfirmDialog } from "./movement-confirm-dialog";
import { TransactionAttachments } from "./transaction-attachments";
import { TransactionConfirmation } from "./transaction-confirmation";
import { TransactionFields } from "./transaction-fields";
import { TransactionStepper } from "./transaction-stepper";
import { useTransactionEdit } from "./use-transaction-edit";

export function TransactionEdit({
  wallet,
  transaction,
}: {
  wallet: WalletSummary;
  transaction: WalletTransaction;
}) {
  const router = useRouter();
  const canFiles = useFeature("transactions.files");
  const canManage = useFeature("transactions.manage");
  const tags = useQuery(api.tags.listTagsByWallet, { walletId: wallet._id });
  const edit = useTransactionEdit(wallet, transaction);
  const [step, setStep] = useState<TransactionStep>(2);
  const [errors, setErrors] = useState<TransactionErrors>({});
  const [leaveTarget, setLeaveTarget] = useState<string>();
  const [confirmingBalance, setConfirmingBalance] = useState<number>();
  const heading = useRef<HTMLHeadingElement>(null);
  const walletHref = `/wallets/${wallet._id}`;
  const detailHref = `${walletHref}/transactions/${transaction._id}`;
  const unavailable =
    wallet.currency !== edit.currency || !!wallet.archivedAt || !canManage;
  const disabled = edit.saving || edit.saved || unavailable;
  const amount = parseMoneyInput(edit.state.values.amount, edit.currency);
  const impact = amount
    ? transactionImpact(
        wallet.balance,
        edit.state.values.type,
        amount,
        edit.baseline,
      )
    : undefined;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

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
        target.origin !== location.origin ||
        target.href === location.href ||
        target.hash ||
        !edit.hasChanges
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!edit.saving) setLeaveTarget(target.pathname + target.search);
    }
    document.addEventListener("click", followLink, true);
    return () => document.removeEventListener("click", followLink, true);
  }, [edit.hasChanges, edit.saving]);

  function leave(target: string) {
    if (edit.saving || edit.saved) return;
    if (edit.hasChanges) setLeaveTarget(target);
    else router.push(target);
  }

  function onField<K extends keyof TransactionFormValues>(
    key: K,
    value: TransactionFormValues[K],
  ) {
    if (disabled) return;
    edit.change((previous) => ({
      ...previous,
      values: { ...previous.values, [key]: value },
    }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || !edit.hasChanges) return;
    const next = validateTransaction(edit.state.values, edit.currency);
    setErrors(next);
    if (Object.keys(next).length) {
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
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    setConfirmingBalance(impact?.balance);
    const id = await edit.commit();
    if (id) {
      toast.success("Cambios guardados");
      router.replace(detailHref);
    } else setConfirmingBalance(undefined);
  }

  return (
    <div className="movement-flow">
      <div className="movement-editor-top">
        <button
          type="button"
          className="movement-text-button"
          disabled={edit.saving || edit.saved}
          onClick={() => leave(walletHref)}
        >
          <ArrowLeft size={18} /> {wallet.name}
        </button>
        <span className="movement-save-status" role="status">
          {edit.saving
            ? "Guardando cambios…"
            : edit.saved
              ? "Cambios guardados"
              : edit.hasChanges
                ? "Cambios sin guardar"
                : "Sin cambios"}
        </span>
      </div>
      <header className="movement-heading">
        <h1 ref={heading} tabIndex={-1}>
          Editar movimiento
        </h1>
        <p>
          Los cambios se aplican al confirmar. Esta edición no crea un borrador.
        </p>
      </header>
      <div className="form-card movement-form-card">
        <TransactionStepper
          editing
          step={step}
          disabled={disabled}
          onBack={setStep}
        />
        {unavailable && (
          <p className="movement-error" role="alert">
            {wallet.archivedAt
              ? "El bolsillo se archivó. Tus cambios siguen aquí; podés guardarlos cuando se restaure."
              : !canManage
                ? "La edición está deshabilitada para tu cuenta. Tus cambios siguen aquí; podés guardarlos cuando se habilite."
                : "La moneda del bolsillo cambió. Tus cambios siguen aquí; volvé a abrir el movimiento para revisar el monto en la moneda actual."}
          </p>
        )}
        {!edit.connected && (
          <p className="movement-notice" role="status">
            Sin conexión. Podés revisar tus cambios aquí y guardarlos cuando
            vuelva.
          </p>
        )}
        <form
          onSubmit={submit}
          noValidate
          aria-busy={edit.saving || edit.saved}
        >
          {step === 2 ? (
            <>
              <TransactionFields
                walletId={wallet._id}
                currency={edit.currency}
                state={edit.state}
                tags={tags ?? []}
                disabled={disabled}
                errors={errors}
                needsAmountReview={false}
                onField={onField}
                onReviewAmount={() => {}}
                onApply={() => {}}
                onKeep={() => {}}
              />
              {canFiles && (
                <TransactionAttachments
                  files={edit.state.files}
                  sourceFileIds={edit.baseline.receiptFileIds}
                  disabled={disabled}
                  onAdd={edit.addFiles}
                  onRename={(id, displayName) =>
                    edit.change((previous) => ({
                      ...previous,
                      files: previous.files.map((file) =>
                        file._id === id
                          ? { ...file, displayName: displayName || undefined }
                          : file,
                      ),
                    }))
                  }
                  onRemove={(id) =>
                    edit.change((previous) => ({
                      ...previous,
                      files: previous.files.filter((file) => file._id !== id),
                    }))
                  }
                />
              )}
            </>
          ) : (
            <TransactionConfirmation
              state={edit.state}
              currency={edit.currency}
              tags={tags ?? []}
              original={edit.baseline}
              sourceFileIds={edit.baseline.receiptFileIds ?? []}
              canFiles={canFiles}
              disabled={disabled}
              onBack={() => setStep(2)}
            />
          )}
          {edit.message && (
            <div className="movement-error" role="alert">
              <p>{edit.message}</p>
              <p>
                Podés reintentar el guardado o volver a los datos para
                corregirlos.
              </p>
            </div>
          )}
          <footer className="movement-save-footer">
            <div className="movement-impact">
              <span>Saldo al guardar cambios</span>
              <strong>
                {impact
                  ? formatMoney(
                      confirmingBalance ?? impact.balance,
                      edit.currency,
                    )
                  : "Ingresá el monto"}
              </strong>
            </div>
            <div className="movement-save-actions">
              <button
                type="button"
                className="button secondary"
                disabled={edit.saving || edit.saved}
                onClick={() => leave(detailHref)}
              >
                Cancelar edición
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={
                  disabled ||
                  !edit.hasChanges ||
                  (step === 3 && !edit.connected)
                }
              >
                {(edit.saving || edit.saved) && (
                  <LoaderCircle size={18} className="spin" />
                )}
                {step === 2 ? (
                  <>
                    Revisar movimiento <ArrowRight size={18} />
                  </>
                ) : (
                  "Guardar cambios"
                )}
              </button>
            </div>
            <p className="movement-help">
              El movimiento original se conserva hasta guardar los cambios.
            </p>
          </footer>
        </form>
      </div>
      {leaveTarget && (
        <MovementConfirmDialog
          title="¿Descartar los cambios?"
          confirmLabel="Descartar cambios"
          cancelLabel="Seguir editando"
          busy={edit.saving}
          onClose={() => setLeaveTarget(undefined)}
          onConfirm={() => {
            void edit.cancel().then((cancelled) => {
              if (cancelled) router.push(leaveTarget);
            });
          }}
        >
          <p>
            Los cambios y los archivos nuevos de esta edición no se guardarán.
            El movimiento registrado se conserva.
          </p>
        </MovementConfirmDialog>
      )}
    </div>
  );
}
