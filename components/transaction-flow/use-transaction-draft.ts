"use client";

import {
  useAction,
  useConvexConnectionState,
  useConvex,
  useMutation,
  useQuery,
} from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createClientId } from "@/lib/client-id";
import { errorMessage } from "@/lib/errors";
import { parseMoneyInput } from "@/lib/money";
import { prepareReceiptFile } from "@/lib/prepare-receipt-file";
import { initialTransactionValues } from "@/lib/transaction-flow";
import {
  MAX_TRANSACTION_FILES,
  MAX_TRANSACTION_FILE_BYTES,
  MAX_TRANSACTION_FILE_NAME_LENGTH,
  normalizedTransactionFileType,
} from "@/lib/transaction-files";
import { uploadTransactionFile } from "@/lib/upload-transaction-file";
import type { TransactionFile } from "@/types/domain";
import type {
  SavedTransactionDraft,
  TransactionEditorState,
  TransactionFormProps,
} from "./types";

type PendingUpload = { files: File[]; forExtraction: boolean };
type Operation = "upload" | "save" | "leave" | "discard";

export function useTransactionDraft({
  wallet,
  transaction,
  initialType = "expense",
  initialDraft,
}: TransactionFormProps & { initialDraft?: SavedTransactionDraft }) {
  const client = useConvex();
  const connected = useConvexConnectionState().isWebSocketConnected;
  const create = useMutation(api.transactionDrafts.create);
  const update = useMutation(api.transactionDrafts.update);
  const save = useMutation(api.transactionDrafts.save);
  const discard = useMutation(api.transactionDrafts.discard);
  const beginFiles = useMutation(api.transactionDrafts.beginFiles);
  const abortFiles = useMutation(api.transactionFiles.abortUpload);
  const signFiles = useAction(api.r2.createUploadUrls);
  const verifyFiles = useAction(api.r2.verifyDraftUpload);
  const [baseline] = useState(transaction);
  const [currency] = useState(initialDraft?.currency ?? wallet.currency);
  const [state, setState] = useState<TransactionEditorState>(() => ({
    values:
      initialDraft?.values ??
      initialTransactionValues(currency, initialType, transaction),
    mode: initialDraft?.mode ?? "manual",
    files: initialDraft?.files ?? transaction?.files ?? [],
    selectedFileIds: initialDraft?.selectedFileIds ?? [],
    reviewedFields: initialDraft?.reviewedFields ?? [],
  }));
  const current = useRef(state);
  const idRef = useRef(initialDraft?._id);
  const version = useRef(initialDraft?.version ?? 0);
  const key = useRef<string | undefined>(undefined);
  const creating = useRef<Promise<Id<"transactionDrafts">> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sequence = useRef(0);
  const persisted = useRef(0);
  const lock = useRef<Operation | null>(null);
  const [dirty, setDirty] = useState(0);
  const [draftId, setDraftId] = useState(initialDraft?._id);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >(initialDraft ? "saved" : "idle");
  const [message, setMessage] = useState<string>();
  const [pendingUpload, setPendingUpload] = useState<PendingUpload>();
  const remote = useQuery(
    api.transactionDrafts.get,
    draftId ? { draftId } : "skip",
  );

  const change = useCallback(
    (transform: (previous: TransactionEditorState) => TransactionEditorState) => {
      const next = transform(current.current);
      current.current = next;
      setState(next);
      sequence.current += 1;
      setDirty(sequence.current);
      setSaveState("idle");
    },
    [],
  );

  const ensureDraft = useCallback(async () => {
    if (idRef.current) return idRef.current;
    if (baseline)
      throw new Error(
        "Volvé a abrir el movimiento para editarlo sin crear un borrador.",
      );
    if (!creating.current) {
      key.current ??= createClientId();
      creating.current = create({
        walletId: wallet._id,
        clientKey: key.current,
        values: current.current.values,
        mode: current.current.mode,
      })
        .then(async (id) => {
          const stored = await client.query(api.transactionDrafts.get, {
            draftId: id,
          });
          if (!stored || stored.status !== "active")
            throw new Error("Este borrador ya no está disponible.");
          version.current = stored.version;
          idRef.current = id;
          setDraftId(id);
          const url = new URL(window.location.href);
          url.searchParams.set("draft", id);
          window.history.replaceState(window.history.state, "", url);
          return id;
        })
        .catch((error) => {
          creating.current = null;
          throw error;
        });
    }
    return creating.current;
  }, [client, create, wallet._id, baseline]);

  const flush = useCallback(async () => {
    const work = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (persisted.current === sequence.current && idRef.current) return;
        if (!connected)
          throw new Error(
            "No hay conexión. Tus datos siguen aquí; reintentá cuando vuelva.",
          );
        setSaveState("saving");
        const id = await ensureDraft();
        const snapshot = current.current;
        const seq = sequence.current;
        version.current = await update({
          draftId: id,
          version: version.current,
          values: snapshot.values,
          mode: snapshot.mode,
          fileIds: snapshot.files.map((file) => file._id),
          selectedFileIds: snapshot.selectedFileIds,
          fileNames: snapshot.files.map((file) => ({
            fileId: file._id,
            displayName: file.displayName,
          })),
          reviewedFields: snapshot.reviewedFields,
        });
        persisted.current = seq;
        setSaveState(sequence.current === seq ? "saved" : "idle");
        setMessage(undefined);
      });
    queue.current = work;
    try {
      await work;
    } catch (error) {
      setSaveState("error");
      setMessage(errorMessage(error));
      throw error;
    }
  }, [connected, ensureDraft, update]);

  useEffect(() => {
    if (!dirty || operation || !connected) return;
    const timer = window.setTimeout(() => {
      void flush().catch(() => undefined);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, operation, connected, flush]);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (
        lock.current ||
        persisted.current !== sequence.current ||
        pendingUpload
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingUpload]);

  async function exclusive<T>(
    name: Operation,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (lock.current) return;
    lock.current = name;
    setOperation(name);
    setMessage(undefined);
    try {
      return await action();
    } catch (error) {
      setMessage(errorMessage(error));
      return undefined;
    } finally {
      lock.current = null;
      setOperation(null);
    }
  }

  async function addFiles(incoming: File[], forExtraction = false) {
    if (!incoming.length) return;
    return exclusive("upload", async () => {
      let batchId: Id<"fileUploadBatches"> | undefined;
      let attached = false;
      setPendingUpload(undefined);
      try {
        if (
          current.current.files.length + incoming.length >
          MAX_TRANSACTION_FILES
        )
          throw new Error("Podés adjuntar hasta 5 archivos por movimiento.");
        const prepared: File[] = [];
        for (const original of incoming) {
          const file = forExtraction
            ? await prepareReceiptFile(original)
            : original;
          const type = normalizedTransactionFileType(file);
          if (!type)
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
          prepared.push(new File([file], file.name, { type }));
        }
        await flush();
        const id = await ensureDraft();
        const batch = await beginFiles({
          draftId: id,
          files: prepared.map((file) => ({
            originalName: file.name,
            mimeType: normalizedTransactionFileType(file)!,
            sizeBytes: file.size,
          })),
        });
        batchId = batch.batchId;
        const signed = await signFiles({ batchId });
        const uploads = new Map(
          signed.uploads.map((upload) => [upload.fileId, upload]),
        );
        const results = await Promise.allSettled(
          batch.fileIds.map(async (fileId, index) => {
            const upload = uploads.get(fileId);
            if (!upload)
              throw new Error(
                "No pudimos preparar uno de los archivos. Reintentá la carga.",
              );
            await uploadTransactionFile(
              upload.url,
              upload.headers,
              prepared[index],
            );
          }),
        );
        const failed = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failed) throw failed.reason;
        await verifyFiles({ draftId: id, batchId });
        const files: TransactionFile[] = prepared.map((file, index) => ({
          _id: batch.fileIds[index],
          originalName: file.name,
          mimeType: normalizedTransactionFileType(file)!,
          sizeBytes: file.size,
          order: current.current.files.length + index,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
        attached = true;
        change((previous) => ({
          ...previous,
          files: [...previous.files, ...files],
          selectedFileIds: forExtraction
            ? [...previous.selectedFileIds, ...batch.fileIds]
            : previous.selectedFileIds,
          reviewedFields: forExtraction ? [] : previous.reviewedFields,
        }));
        await flush();
        return true;
      } catch (error) {
        // Preserve verified files if the following autosave lost its response.
        // Aborting that batch could delete documents the server already attached.
        if (batchId && !attached) {
          try {
            await abortFiles({ batchId });
          } catch {
            /* Scheduled TTL cleanup is the fallback. */
          }
        }
        if (!attached) setPendingUpload({ files: incoming, forExtraction });
        throw error;
      }
    });
  }

  async function commit() {
    return exclusive("save", async () => {
      if (pendingUpload)
        throw new Error(
          "Reintentá la carga pendiente o elegí seguir sin esos archivos.",
        );
      await flush();
      const values = current.current.values;
      const amountMinor = parseMoneyInput(values.amount, currency);
      if (!amountMinor) throw new Error("Revisá el monto antes de registrar.");
      const id = await save({
        draftId: await ensureDraft(),
        version: version.current,
        currency,
        type: values.type,
        amountMinor,
        description: values.description.trim(),
        date: values.date,
        notes: values.notes.trim() || undefined,
        tagIds: values.tagIds,
      });
      persisted.current = sequence.current;
      return id;
    });
  }

  async function leave() {
    return exclusive("leave", async () => {
      if (pendingUpload)
        throw new Error(
          "Reintentá la carga pendiente o elegí seguir sin esos archivos.",
        );
      if (sequence.current || idRef.current) await flush();
      return true;
    });
  }

  async function discardDraft() {
    return exclusive("discard", async () => {
      await queue.current.catch(() => undefined);
      if (idRef.current) await discard({ draftId: idRef.current });
      persisted.current = sequence.current;
      setPendingUpload(undefined);
      return true;
    });
  }

  return {
    state,
    current,
    currency,
    draftId,
    remote,
    version,
    operation,
    saveState,
    message,
    connected,
    pendingUpload,
    hasChanges: dirty > 0,
    busy: operation !== null,
    change,
    flush,
    ensureDraft,
    addFiles,
    commit,
    leave,
    discardDraft,
    setMessage,
    retryUpload: () =>
      pendingUpload &&
      addFiles(pendingUpload.files, pendingUpload.forExtraction),
    cancelUpload: () => {
      setPendingUpload(undefined);
      setMessage(undefined);
    },
  };
}

export type TransactionDraftController = ReturnType<typeof useTransactionDraft>;
