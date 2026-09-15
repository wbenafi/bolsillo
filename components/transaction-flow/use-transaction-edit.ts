"use client";

import { useAction, useConvexConnectionState, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createClientId } from "@/lib/client-id";
import { errorCode, errorMessage } from "@/lib/errors";
import { parseMoneyInput } from "@/lib/money";
import { initialTransactionValues } from "@/lib/transaction-flow";
import {
  MAX_TRANSACTION_FILES,
  MAX_TRANSACTION_FILE_BYTES,
  MAX_TRANSACTION_FILE_NAME_LENGTH,
  normalizedTransactionFileType,
} from "@/lib/transaction-files";
import { uploadTransactionFile } from "@/lib/upload-transaction-file";
import type {
  LocalTransactionFile,
  TransactionAttachment,
  WalletSummary,
  WalletTransaction,
} from "@/types/domain";
import type { TransactionEditorState } from "./types";

type EditState = TransactionEditorState<TransactionAttachment>;
type UploadAttempt = { batchId: Id<"fileUploadBatches">; signature: string };
const manifest = (files: TransactionAttachment[]) =>
  files.map((file, order) => ({
    fileId: file._id,
    displayName: file.displayName,
    order,
  }));

/** Local editing only. The first server write happens after explicit confirmation. */
export function useTransactionEdit(
  wallet: WalletSummary,
  transaction: WalletTransaction,
) {
  const [baseline] = useState(transaction);
  const [currency] = useState(wallet.currency);
  const [initial] = useState<EditState>(() => ({
    values: initialTransactionValues(currency, transaction.type, transaction),
    mode: "manual",
    files: transaction.files ?? [],
    selectedFileIds: [],
    reviewedFields: [],
  }));
  const [state, setState] = useState(initial);
  const current = useRef(state);
  const locked = useRef(false);
  const attempt = useRef<UploadAttempt | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string>();
  const connected = useConvexConnectionState().isWebSocketConnected;
  const update = useMutation(api.transactions.updateTransaction);
  const updateFiles = useMutation(
    api.transactionFiles.updateTransactionWithFiles,
  );
  const begin = useMutation(api.transactionFiles.beginUpload);
  const abort = useMutation(api.transactionFiles.abortUpload);
  const sign = useAction(api.r2.createUploadUrls);
  const finalize = useAction(api.r2.finalizeUpload);
  const filesChanged =
    JSON.stringify(manifest(state.files)) !==
    JSON.stringify(manifest(initial.files));
  const hasChanges =
    !saved &&
    (filesChanged ||
      JSON.stringify(state.values) !== JSON.stringify(initial.values));

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!saved && (hasChanges || locked.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges, saved]);

  function change(transform: (previous: EditState) => EditState) {
    if (locked.current || saved) return;
    current.current = transform(current.current);
    setState(current.current);
    setMessage(undefined);
  }

  function addFiles(incoming: File[]) {
    if (locked.current || saved || !incoming.length) return;
    try {
      if (
        current.current.files.length + incoming.length >
        MAX_TRANSACTION_FILES
      )
        throw new Error("Podés adjuntar hasta 5 archivos por movimiento.");
      const added: LocalTransactionFile[] = incoming.map((file, index) => {
        const mimeType = normalizedTransactionFileType(file);
        if (!mimeType)
          throw new Error(`${file.name}: elegí JPG, PNG, WebP, PDF o TXT.`);
        if (file.size < 1 || file.size > MAX_TRANSACTION_FILE_BYTES)
          throw new Error(
            `${file.name}: elegí un archivo con contenido, de hasta 2 MB.`,
          );
        if (
          !file.name.trim() ||
          file.name.length > MAX_TRANSACTION_FILE_NAME_LENGTH
        )
          throw new Error(
            "Acortá el nombre del archivo a 180 caracteres o menos.",
          );
        return {
          _id: createClientId(),
          localFile: file,
          originalName: file.name,
          mimeType,
          sizeBytes: file.size,
          order: current.current.files.length + index,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      });
      change((previous) => ({
        ...previous,
        files: [...previous.files, ...added],
      }));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function cancel() {
    if (locked.current) return false;
    if (attempt.current) {
      // Local discard must also work offline. TTL cleanup remains the fallback.
      void abort({ batchId: attempt.current.batchId }).catch(() => {});
      attempt.current = undefined;
    }
    setSaved(true);
    return true;
  }

  async function commit() {
    if (locked.current || saved) return;
    locked.current = true;
    setSaving(true);
    setMessage(undefined);
    let uploadBatch: Id<"fileUploadBatches"> | undefined;
    let finalizing = false;
    try {
      if (!connected)
        throw new Error(
          "No hay conexión. Tus cambios siguen aquí; reintentá cuando vuelva.",
        );
      const snapshot = current.current;
      const amountMinor = parseMoneyInput(snapshot.values.amount, currency);
      if (!amountMinor) throw new Error("Revisá el monto antes de guardar.");
      const payload = {
        type: snapshot.values.type,
        amountMinor,
        description: snapshot.values.description.trim(),
        date: snapshot.values.date,
        notes: snapshot.values.notes.trim() || undefined,
        tagIds: snapshot.values.tagIds,
      };
      const preconditions = {
        expectedRevision: baseline.revision ?? 0,
        currency,
      };
      const retained = snapshot.files.flatMap((file, order) =>
        "localFile" in file
          ? []
          : [{ fileId: file._id, displayName: file.displayName, order }],
      );
      const local = snapshot.files.filter(
        (file): file is LocalTransactionFile => "localFile" in file,
      );
      const signature = JSON.stringify({
        payload,
        files: manifest(snapshot.files),
      });
      if (attempt.current && attempt.current.signature !== signature) {
        await abort({ batchId: attempt.current.batchId });
        attempt.current = undefined;
      }
      if (local.length) {
        uploadBatch = attempt.current?.batchId;
        if (!uploadBatch) {
          const batch = await begin({
            walletId: wallet._id,
            transactionId: baseline._id,
            expectedFileRevision: baseline.fileRevision ?? 0,
            ...preconditions,
            retainedFileIds: retained.map((file) => file.fileId),
            files: local.map((file) => ({
              originalName: file.originalName,
              displayName: file.displayName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              order: snapshot.files.indexOf(file),
            })),
          });
          uploadBatch = batch.batchId;
          const signed = await sign({ batchId: uploadBatch });
          const urls = new Map(
            signed.uploads.map((upload) => [upload.fileId, upload]),
          );
          const results = await Promise.allSettled(
            batch.fileIds.map(async (id, index) => {
              const upload = urls.get(id);
              if (!upload)
                throw new Error(
                  "No pudimos preparar un archivo. Reintentá el guardado.",
                );
              await uploadTransactionFile(
                upload.url,
                upload.headers,
                local[index].localFile,
              );
            }),
          );
          const failure = results.find(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          );
          if (failure) throw failure.reason;
          attempt.current = { batchId: uploadBatch, signature };
        }
        finalizing = true;
        await finalize({
          batchId: uploadBatch,
          retainedFiles: retained,
          ...payload,
        });
        attempt.current = undefined;
      } else if (filesChanged) {
        await updateFiles({
          transactionId: baseline._id,
          expectedFileRevision: baseline.fileRevision ?? 0,
          files: retained,
          ...preconditions,
          ...payload,
        });
      } else {
        await update({
          transactionId: baseline._id,
          ...preconditions,
          ...payload,
        });
      }
      setSaved(true);
      return baseline._id;
    } catch (error) {
      // Keep a verified batch for an identical retry: finalize is idempotent even
      // when the first response was lost. Changed input starts a fresh batch and
      // revision checks prevent overwriting an earlier successful confirmation.
      const batchUnavailable = ["UPLOAD_EXPIRED", "UPLOAD_NOT_FOUND"].includes(
        errorCode(error) ?? "",
      );
      if (uploadBatch && (!finalizing || batchUnavailable)) {
        // Release the operation even if cleanup must wait for reconnection.
        void abort({ batchId: uploadBatch }).catch(() => {});
        attempt.current = undefined;
      }
      setMessage(errorMessage(error));
      return undefined;
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  return {
    state,
    baseline,
    currency,
    connected,
    saving,
    saved,
    hasChanges,
    filesChanged,
    message,
    change,
    addFiles,
    commit,
    cancel,
  };
}
