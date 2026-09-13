"use client";

import { useAction } from "convex/react";
import { Camera, FileText, Paperclip, Plus, ReceiptText, X, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TransactionFile } from "@/types/domain";
import { TRANSACTION_FILE_ACCEPT } from "@/lib/transaction-files";
import { FileViewerDialog } from "./file-viewer-dialog";

export function ReceiptDocuments({ draftId, files, selected, onSelect, onRemove, onAdd, disabled, uploading }: {
  draftId?: Id<"transactionDrafts">; files: TransactionFile[]; selected: Id<"transactionFiles">[];
  onSelect: (ids: Id<"transactionFiles">[]) => void; onRemove: (id: Id<"transactionFiles">) => void;
  onAdd: (files: File[]) => void; disabled: boolean; uploading: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<Id<"transactionFiles">>();
  const [expanded, setExpanded] = useState(false);
  const preview = files.find(f => f._id === previewId) ?? files[0];
  const full = disabled || uploading || files.length >= 5;
  function picked(input: HTMLInputElement) { const files = Array.from(input.files ?? []); input.value = ""; if (files.length) onAdd(files); }
  return <section className="receipt-documents" aria-label="Comprobantes del movimiento">
    <div className="receipt-preview">
      {preview ? <ReceiptPreview file={preview} draftId={draftId} onOpen={() => setExpanded(true)} /> : <div className="receipt-empty"><span className="receipt-empty-icon"><ReceiptText size={28} /></span><strong>Tu comprobante, aquí</strong><p>Tomá una foto o elegí un archivo.<br />Te ayudamos a completar los datos.</p></div>}
      {uploading && <div className="receipt-uploading" role="status"><LoaderCircle size={20} className="spin" /> Preparando tus archivos…</div>}
    </div>
    <div className="receipt-add-actions">
      <button className="button secondary" type="button" onClick={() => camera.current?.click()} disabled={full}><span className="receipt-icon-plus"><Camera size={21} /><Plus size={11} /></span> Foto</button>
      <button className="button secondary" type="button" onClick={() => picker.current?.click()} disabled={full}><span className="receipt-icon-plus"><Paperclip size={21} /><Plus size={11} /></span> Archivo</button>
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => picked(e.currentTarget)} hidden />
      <input ref={picker} type="file" accept={TRANSACTION_FILE_ACCEPT} multiple onChange={e => picked(e.currentTarget)} hidden />
    </div>
    <p className="receipt-help">{files.length ? `${files.length} de 5 archivos · Del mismo comprobante` : "Fotos, PDF o TXT · Hasta 5 archivos de 2 MB"}</p>
    {!!files.length && <ul className="receipt-file-list">{files.map((file, index) => <li key={file._id} className={preview?._id === file._id ? "selected" : ""}>
      <label className="receipt-file-check"><input type="checkbox" checked={selected.includes(file._id)} onChange={e => onSelect(e.target.checked ? [...selected, file._id] : selected.filter(id => id !== file._id))} disabled={disabled || uploading} aria-label={`Leer ${file.originalName}`} /></label>
      <button type="button" className="receipt-file-name" onClick={() => setPreviewId(file._id)} aria-label={`Vista previa: ${file.originalName}`}><FileText size={17} /><span>{file.displayName || file.originalName}<small>Archivo {index + 1}</small></span></button>
      <button type="button" className="receipt-remove" aria-label={`Quitar ${file.originalName}`} onClick={() => onRemove(file._id)} disabled={disabled || uploading}><X size={18} /></button>
    </li>)}</ul>}
    {files.length > 1 && <p className="receipt-help">Marcá los archivos que querés leer juntos.</p>}
    {expanded && preview && <FileViewerDialog draftId={draftId} file={{ ...preview, kind: "stored" }} onClose={() => setExpanded(false)} />}
  </section>;
}
function ReceiptPreview({ file, draftId, onOpen }: { file: TransactionFile; draftId?: Id<"transactionDrafts">; onOpen: () => void }) {
  const read = useAction(api.transactionAI.readDraftFile);
  const readStored = useAction(api.r2.createReadUrl);
  const [preview, setPreview] = useState<{ id: string; url?: string; text?: string; failed?: boolean }>();
  useEffect(() => {
    let disposed = false;
    let url: string | undefined;
    async function load() {
      try {
        const signed = draftId ? await read({ draftId, fileId: file._id }) : await readStored({ fileId: file._id });
        const response = await fetch(signed.url, { cache: "no-store" });
        if (!response.ok) throw new Error("Preview failed");
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        const text = file.mimeType === "text/plain" ? (await blob.text()).slice(0, 600) : undefined;
        if (disposed) URL.revokeObjectURL(url); else setPreview({ id: file._id, url, text });
      } catch { if (!disposed) setPreview({ id: file._id, failed: true }); }
    }
    void load();
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [draftId, file._id, file.mimeType, read, readStored]);
  const current = preview?.id === file._id ? preview : undefined;
  return <button type="button" className="receipt-preview-open" onClick={onOpen} aria-label={`Ampliar ${file.originalName}`}>
    {!current ? <LoaderCircle className="spin" size={24} /> : current.failed ? <span>No pudimos cargar la vista previa. Tocá para reintentar.</span> : file.mimeType.startsWith("image/") && current.url ? <Image src={current.url} alt={file.originalName} fill unoptimized sizes="(max-width: 640px) 90vw, 560px" /> : current.text ? <pre>{current.text}</pre> : <span className="receipt-pdf"><FileText size={40} /><strong>{file.originalName}</strong><small>Tocá para ver el PDF</small></span>}
    {current?.url && file.mimeType.startsWith("image/") && <span className="receipt-preview-caption">Tocá para ampliar</span>}
  </button>;
}
