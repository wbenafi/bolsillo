"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { TagSelector } from "@/components/tag-selector";
import {
  TransactionFilesField,
  type LocalTransactionFileDraft,
  type StoredTransactionFileDraft,
  type TransactionFileDraft,
} from "@/components/transaction-files-field";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { todayInputValue } from "@/lib/date";
import { errorMessage } from "@/lib/errors";
import { moneyInputValue, parseMoneyInput } from "@/lib/money";
import { transactionSchema, type TransactionFormValues } from "@/lib/validators";
import type { Currency, TransactionType, WalletTag, WalletTransaction } from "@/types/domain";

type TransactionFormProps = {
  walletId: Id<"wallets">;
  currency: Currency;
  initialType?: TransactionType;
  transaction?: WalletTransaction;
  onDeletingChange?: (isDeleting: boolean) => void;
};

function initialFileDrafts(transaction?: WalletTransaction): TransactionFileDraft[] {
  return (transaction?.files ?? []).map((file): StoredTransactionFileDraft => ({
    ...file,
    kind: "stored",
  }));
}

export function TransactionForm({ walletId, currency, initialType = "expense", transaction, onDeletingChange }: TransactionFormProps) {
  const router = useRouter();
  const createTransaction = useMutation(api.transactions.createTransaction);
  const updateTransaction = useMutation(api.transactions.updateTransaction);
  const deleteTransaction = useMutation(api.transactions.deleteTransaction);
  const beginFileUpload = useMutation(api.transactionFiles.beginUpload);
  const abortFileUpload = useMutation(api.transactionFiles.abortUpload);
  const updateTransactionWithFiles = useMutation(api.transactionFiles.updateTransactionWithFiles);
  const createUploadUrls = useAction(api.r2.createUploadUrls);
  const finalizeUpload = useAction(api.r2.finalizeUpload);
  const tags = useQuery(api.tags.listTagsByWallet, { walletId }) as WalletTag[] | undefined;
  const canManageFiles = useFeature("transactions.files");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<TransactionFileDraft[]>(() => initialFileDrafts(transaction));
  const { register, handleSubmit, control, setValue, formState: { errors, isSubmitting } } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: transaction?.type ?? initialType,
      amount: transaction ? moneyInputValue(transaction.amountMinor, currency) : "",
      description: transaction?.description ?? "",
      date: transaction?.date ?? todayInputValue(),
      notes: transaction?.notes ?? "",
      tagIds: transaction?.tagIds ?? [],
    },
  });
  const selectedType = useWatch({ control, name: "type" });
  const selectedTagIds = useWatch({ control, name: "tagIds" });

  const storedFiles = files.filter((file): file is StoredTransactionFileDraft => file.kind === "stored");
  const localFiles = files.filter((file): file is LocalTransactionFileDraft => file.kind === "local");
  const originalFiles = transaction?.files ?? [];
  const existingFilesChanged = transaction
    ? storedFiles.length !== originalFiles.length || storedFiles.some((file) => {
        const original = originalFiles.find(({ _id }) => _id === file._id);
        return !original || original.order !== file.order || (original.displayName ?? "") !== (file.displayName ?? "");
      })
    : false;

  function setLocalUploadStatus(clientId: string, uploadStatus: LocalTransactionFileDraft["uploadStatus"]) {
    setFiles((current) => current.map((file) =>
      file.kind === "local" && file.clientId === clientId ? { ...file, uploadStatus } : file));
  }

  async function removeTransaction() {
    if (!transaction) return;
    const filesWarning = transaction.fileCount
      ? "\nTambién se eliminarán permanentemente sus archivos."
      : "";
    if (!window.confirm(`¿Eliminar este movimiento?\nEsta acción cambiará el saldo del bolsillo.${filesWarning}`)) return;
    setIsDeleting(true);
    onDeletingChange?.(true);
    try {
      await deleteTransaction({ transactionId: transaction._id });
      toast.success("Movimiento eliminado");
      router.replace(`/wallets/${walletId}`);
    } catch (error) {
      toast.error(errorMessage(error));
      onDeletingChange?.(false);
      setIsDeleting(false);
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    const amountMinor = parseMoneyInput(values.amount, currency);
    if (!amountMinor) {
      toast.error(currency === "CRC" ? "Ingresá un monto entero mayor que cero." : "Ingresá un monto válido mayor que cero.");
      return;
    }
    const payload = {
      type: values.type,
      amountMinor,
      description: values.description.trim(),
      date: values.date,
      notes: values.notes.trim() || undefined,
      tagIds: values.tagIds.length ? values.tagIds : undefined,
    };
    const retainedFiles = storedFiles.map((file) => ({
      fileId: file._id,
      displayName: file.displayName?.trim() || undefined,
      order: file.order,
    }));
    let batchId: Id<"fileUploadBatches"> | undefined;

    try {
      if (canManageFiles && localFiles.length) {
        setIsUploading(true);
        localFiles.forEach((file) => setLocalUploadStatus(file.clientId, "uploading"));
        const batch = await beginFileUpload({
          walletId,
          transactionId: transaction?._id,
          retainedFileIds: retainedFiles.map(({ fileId }) => fileId),
          files: localFiles.map((file) => ({
            originalName: file.originalName,
            displayName: file.displayName?.trim() || undefined,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            order: file.order,
          })),
        });
        batchId = batch.batchId;
        const signed = await createUploadUrls({ batchId });
        const uploadById = new Map(signed.uploads.map((upload) => [upload.fileId, upload]));
        const results = await Promise.allSettled(
          batch.fileIds.map(async (fileId, index) => {
            const localFile = localFiles[index];
            const upload = uploadById.get(fileId);
            if (!upload || !localFile) throw new Error("No se pudo preparar uno de los archivos.");
            const response = await fetch(upload.url, {
              method: "PUT",
              headers: upload.headers,
              body: localFile.file,
            });
            if (!response.ok) throw new Error(`${localFile.originalName}: R2 rechazó la carga.`);
            setLocalUploadStatus(localFile.clientId, "uploaded");
          }),
        );
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) throw failed.reason;
        await finalizeUpload({ batchId, retainedFiles, ...payload });
      } else if (transaction) {
        if (canManageFiles && existingFilesChanged) {
          await updateTransactionWithFiles({ transactionId: transaction._id, files: retainedFiles, ...payload });
        } else {
          await updateTransaction({ transactionId: transaction._id, ...payload });
        }
      } else {
        await createTransaction({ walletId, ...payload });
      }

      if (transaction) toast.success("Movimiento actualizado");
      else toast.success(values.type === "income" ? "Ingreso agregado" : "Gasto agregado");
      router.push(`/wallets/${walletId}`);
    } catch (error) {
      if (batchId) {
        try { await abortFileUpload({ batchId }); } catch { /* Scheduled cleanup is the fallback. */ }
      }
      if (localFiles.length) {
        setFiles((current) => current.map((file) => file.kind === "local"
          ? { ...file, uploadStatus: "error" }
          : file));
      }
      toast.error(errorMessage(error));
    } finally {
      setIsUploading(false);
    }
  });

  const busy = isSubmitting || isDeleting || isUploading;

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      <fieldset className="type-picker">
        <legend>Tipo de movimiento</legend>
        <button type="button" className={selectedType === "income" ? "type-option income active" : "type-option income"} onClick={() => setValue("type", "income")} aria-pressed={selectedType === "income"}>
          <ArrowDownLeft /> Ingreso
        </button>
        <button type="button" className={selectedType === "expense" ? "type-option expense active" : "type-option expense"} onClick={() => setValue("type", "expense")} aria-pressed={selectedType === "expense"}>
          <ArrowUpRight /> Gasto
        </button>
        <input type="hidden" {...register("type")} />
      </fieldset>
      <div className="field amount-field">
        <label htmlFor="amount">Monto</label>
        <div className="amount-input"><span>{currency === "CRC" ? "₡" : "$"}</span><input id="amount" autoFocus inputMode="decimal" placeholder="0" {...register("amount")} /></div>
        {errors.amount && <p className="field-error">{errors.amount.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="description">Descripción</label>
        <input id="description" maxLength={100} placeholder={selectedType === "income" ? "Ej. Aporte inicial" : "Ej. Compra de materiales"} {...register("description")} />
        {errors.description && <p className="field-error">{errors.description.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="date">Fecha</label>
        <input id="date" type="date" {...register("date")} />
        {errors.date && <p className="field-error">{errors.date.message}</p>}
      </div>
      <div className="field">
        <label htmlFor="notes">Notas <span>Opcional</span></label>
        <textarea id="notes" rows={3} maxLength={500} placeholder="Agregá un detalle que quieras recordar" {...register("notes")} />
      </div>
      <TagSelector
        walletId={walletId}
        tags={tags ?? []}
        selectedTagIds={selectedTagIds}
        onChange={(tagIds) => setValue("tagIds", tagIds, { shouldDirty: true })}
      />
      {canManageFiles && <TransactionFilesField files={files} onChange={setFiles} disabled={busy} />}
      <div className={transaction ? "form-actions edit-actions" : "form-actions"}>
        {transaction && (
          <button type="button" className="button destructive" onClick={removeTransaction} disabled={busy}>
            {isDeleting && <LoaderCircle className="spin" size={18} />}
            Eliminar movimiento
          </button>
        )}
        <div className="form-actions-main">
          <button type="button" className="button secondary" onClick={() => router.back()} disabled={busy}>Cancelar</button>
          <button type="submit" className="button primary" disabled={busy}>
            {(isSubmitting || isUploading) && <LoaderCircle className="spin" size={18} />}
            {isUploading ? "Guardando archivos…" : transaction ? "Guardar cambios" : "Guardar movimiento"}
          </button>
        </div>
      </div>
    </form>
  );
}
