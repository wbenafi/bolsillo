"use client";

import { useAction } from "convex/react";
import { Download, LoaderCircle, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { transactionFileKind } from "@/lib/transaction-files";
import type { TransactionFileDraft } from "@/components/transaction-files-field";

type FileViewerDialogProps = {
  file: TransactionFileDraft;
  onClose: () => void;
};

function downloadName(file: TransactionFileDraft) {
  const requested = file.displayName?.trim();
  if (!requested) return file.originalName;
  const extension = file.originalName.match(/\.[^.]+$/)?.[0] ?? "";
  const withExtension = extension && !requested.toLocaleLowerCase("en").endsWith(extension.toLocaleLowerCase("en"))
    ? `${requested}${extension}`
    : requested;
  return withExtension.replaceAll("/", "-").replaceAll("\\", "-");
}

export function FileViewerDialog({ file, onClose }: FileViewerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const createReadUrl = useAction(api.r2.createReadUrl);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const kind = transactionFileKind(file.mimeType);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let canceled = false;
    let generatedUrl: string | undefined;

    async function load() {
      setError(undefined);
      setSourceUrl(undefined);
      setText(undefined);
      try {
        if (file.kind === "local") {
          if (kind === "text") setText(await file.file.text());
          if (!canceled) setSourceUrl(file.objectUrl);
          return;
        }
        const signed = await createReadUrl({ fileId: file._id });
        const response = await fetch(signed.url, { cache: "no-store" });
        if (!response.ok) throw new Error("No se pudo descargar el archivo privado.");
        const blob = await response.blob();
        generatedUrl = URL.createObjectURL(blob);
        if (kind === "text") {
          const contents = await blob.text();
          if (!canceled) setText(contents);
        }
        if (!canceled) setSourceUrl(generatedUrl);
      } catch (loadError) {
        if (!canceled) setError(errorMessage(loadError));
      }
    }

    void load();
    return () => {
      canceled = true;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [createReadUrl, file, kind]);

  function download() {
    if (!sourceUrl) return;
    const anchor = document.createElement("a");
    anchor.href = sourceUrl;
    anchor.download = downloadName(file);
    anchor.click();
  }

  const title = file.displayName?.trim() || file.originalName;

  return (
    <dialog
      ref={dialogRef}
      className="file-viewer-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="file-viewer-shell">
        <header>
          <div><p className="eyebrow">Vista previa</p><h2>{title}</h2></div>
          <div>
            <button type="button" className="button secondary" onClick={download} disabled={!sourceUrl || Boolean(error)}><Download /> Descargar</button>
            <button type="button" className="icon-link" onClick={onClose} aria-label="Cerrar vista previa"><X /></button>
          </div>
        </header>
        <div className={`file-viewer-content ${kind}`}>
          {!sourceUrl && !error && <div className="file-viewer-loading"><LoaderCircle className="spin" /><span>Preparando archivo privado…</span></div>}
          {error && <div className="file-viewer-error"><strong>No pudimos abrir el archivo</strong><p>{error}</p></div>}
          {!error && sourceUrl && kind === "image" && <div className="file-viewer-image"><Image src={sourceUrl} alt={title} fill sizes="100vw" unoptimized /></div>}
          {!error && sourceUrl && kind === "pdf" && <iframe src={sourceUrl} title={title} />}
          {!error && sourceUrl && kind === "text" && <pre>{text}</pre>}
        </div>
      </div>
    </dialog>
  );
}
