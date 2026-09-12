"use client";

import { useAction } from "convex/react";
import { Eye, File, FileImage, FileText, LoaderCircle, Upload, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FileViewerDialog } from "@/components/file-viewer-dialog";
import { api } from "@/convex/_generated/api";
import {
  formatFileSize,
  MAX_TRANSACTION_FILE_BYTES,
  MAX_TRANSACTION_FILE_NAME_LENGTH,
  MAX_TRANSACTION_FILES,
  normalizedTransactionFileType,
  TRANSACTION_FILE_ACCEPT,
  transactionFileKind,
  type TransactionFileType,
} from "@/lib/transaction-files";
import type { TransactionFile } from "@/types/domain";

export type StoredTransactionFileDraft = TransactionFile & {
  kind: "stored";
};

export type LocalTransactionFileDraft = {
  kind: "local";
  clientId: string;
  file: File;
  objectUrl: string;
  originalName: string;
  displayName?: string;
  mimeType: TransactionFileType;
  sizeBytes: number;
  order: number;
  uploadStatus: "ready" | "uploading" | "uploaded" | "error";
};

export type TransactionFileDraft = StoredTransactionFileDraft | LocalTransactionFileDraft;

type TransactionFilesFieldProps = {
  files: TransactionFileDraft[];
  onChange: (files: TransactionFileDraft[]) => void;
  disabled?: boolean;
  loading?: boolean;
};

function FileIcon({ mimeType }: { mimeType: TransactionFileType }) {
  const kind = transactionFileKind(mimeType);
  if (kind === "image") return <FileImage />;
  if (kind === "text") return <FileText />;
  return <File />;
}

function StoredImagePreview({ file }: { file: StoredTransactionFileDraft }) {
  const createReadUrl = useAction(api.r2.createReadUrl);
  const [sourceUrl, setSourceUrl] = useState<string>();

  useEffect(() => {
    let canceled = false;
    let objectUrl: string | undefined;
    async function load() {
      try {
        const signed = await createReadUrl({ fileId: file._id });
        const response = await fetch(signed.url, { cache: "no-store" });
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (!canceled) setSourceUrl(objectUrl);
      } catch {
        // The file card remains usable even if a thumbnail cannot be prepared.
      }
    }
    void load();
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [createReadUrl, file._id]);

  if (!sourceUrl) return <LoaderCircle className="spin" />;
  return <Image src={sourceUrl} alt="" fill sizes="72px" unoptimized />;
}

export function TransactionFilesField({ files, onChange, disabled = false, loading = false }: TransactionFilesFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const localObjectUrls = useRef(new Set<string>());
  const [viewerFile, setViewerFile] = useState<TransactionFileDraft>();
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    localObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    localObjectUrls.current.clear();
  }, []);

  function reindexed(nextFiles: TransactionFileDraft[]) {
    return nextFiles.map((file, order) => ({ ...file, order })) as TransactionFileDraft[];
  }

  function addFiles(selected: FileList | File[]) {
    const available = MAX_TRANSACTION_FILES - files.length;
    if (available < 1) {
      toast.error(`Podés adjuntar hasta ${MAX_TRANSACTION_FILES} archivos por movimiento.`);
      return;
    }
    const candidates = Array.from(selected);
    if (candidates.length > available) {
      toast.error(`Solo quedan ${available} ${available === 1 ? "espacio" : "espacios"} disponibles.`);
    }
    const accepted: LocalTransactionFileDraft[] = [];
    for (const file of candidates.slice(0, available)) {
      const mimeType = normalizedTransactionFileType(file);
      if (!mimeType) {
        toast.error(`${file.name}: usá JPG, PNG, WebP, PDF o TXT.`);
        continue;
      }
      if (file.size < 1 || file.size > MAX_TRANSACTION_FILE_BYTES) {
        toast.error(`${file.name}: el archivo debe pesar 2 MB o menos.`);
        continue;
      }
      if (file.name.trim().length < 1 || file.name.length > MAX_TRANSACTION_FILE_NAME_LENGTH) {
        toast.error(`${file.name || "El archivo"}: el nombre no es válido.`);
        continue;
      }
      const objectUrl = URL.createObjectURL(file);
      localObjectUrls.current.add(objectUrl);
      accepted.push({
        kind: "local",
        clientId: crypto.randomUUID(),
        file,
        objectUrl,
        originalName: file.name,
        mimeType,
        sizeBytes: file.size,
        order: files.length + accepted.length,
        uploadStatus: "ready",
      });
    }
    if (accepted.length) onChange(reindexed([...files, ...accepted]));
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(file: TransactionFileDraft) {
    if (file.kind === "local") {
      URL.revokeObjectURL(file.objectUrl);
      localObjectUrls.current.delete(file.objectUrl);
    }
    onChange(reindexed(files.filter((candidate) => candidate !== file)));
  }

  function renameFile(file: TransactionFileDraft, displayName: string) {
    onChange(files.map((candidate) => candidate === file
      ? { ...candidate, displayName: displayName || undefined }
      : candidate) as TransactionFileDraft[]);
  }

  return (
    <section className="transaction-files-field">
      <div className="transaction-files-heading">
        <div><span>Archivos <small>Opcional</small></span><p>JPG, PNG, WebP, PDF o TXT. Máximo 2 MB por archivo.</p></div>
        <strong>{files.length}/{MAX_TRANSACTION_FILES}</strong>
      </div>

      <label
        className={`file-dropzone${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(event.dataTransfer.files);
        }}
      >
        <Upload /><span><strong>Seleccionar archivos</strong> o arrastrarlos aquí</span>
        <input ref={inputRef} type="file" accept={TRANSACTION_FILE_ACCEPT} multiple disabled={disabled || files.length >= MAX_TRANSACTION_FILES} onChange={(event) => event.target.files && addFiles(event.target.files)} />
      </label>

      {loading && <div className="file-list-loading"><LoaderCircle className="spin" /> Cargando archivos privados…</div>}
      {!loading && files.length > 0 && (
        <div className="transaction-file-list">
          {files.map((file) => {
            const kind = transactionFileKind(file.mimeType);
            const title = file.displayName?.trim() || file.originalName;
            return (
              <article key={file.kind === "stored" ? file._id : file.clientId}>
                <button type="button" className={`file-preview ${kind}`} onClick={() => setViewerFile(file)} disabled={disabled} aria-label={`Ver ${title}`}>
                  {kind === "image" && file.kind === "local" && <Image src={file.objectUrl} alt="" fill sizes="72px" unoptimized />}
                  {kind === "image" && file.kind === "stored" && <StoredImagePreview file={file} />}
                  {kind !== "image" && <FileIcon mimeType={file.mimeType} />}
                  <Eye className="file-preview-eye" />
                </button>
                <div className="file-card-copy">
                  <label>Nombre <span>Opcional</span><input value={file.displayName ?? ""} maxLength={100} disabled={disabled} placeholder={file.originalName} onChange={(event) => renameFile(file, event.target.value)} /></label>
                  <small>{file.originalName} · {formatFileSize(file.sizeBytes)}</small>
                  {file.kind === "local" && file.uploadStatus !== "ready" && <span className={`upload-status ${file.uploadStatus}`}>{file.uploadStatus === "uploading" ? "Subiendo…" : file.uploadStatus === "uploaded" ? "Subido" : "No se pudo subir"}</span>}
                </div>
                <button type="button" className="icon-link destructive" onClick={() => removeFile(file)} disabled={disabled} aria-label={`Quitar ${title}`}><X /></button>
              </article>
            );
          })}
        </div>
      )}
      {viewerFile && <FileViewerDialog file={viewerFile} onClose={() => setViewerFile(undefined)} />}
    </section>
  );
}
