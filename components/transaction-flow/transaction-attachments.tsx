"use client";

import {
  FileText,
  LoaderCircle,
  PencilLine,
  Plus,
  ReceiptText,
  Trash2,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import type { Id } from "@/convex/_generated/dataModel";
import {
  formatFileSize,
  MAX_TRANSACTION_FILES,
  TRANSACTION_FILE_ACCEPT,
} from "@/lib/transaction-files";
import type { TransactionAttachment } from "@/types/domain";

type Props = {
  files: TransactionAttachment[];
  draftId?: Id<"transactionDrafts">;
  sourceFileIds?: Id<"transactionFiles">[];
  disabled?: boolean;
  uploading?: boolean;
  onAdd?: (files: File[]) => void;
  onRename?: (id: string, name: string) => void;
  onRemove?: (id: string) => void;
};

export function TransactionAttachments({
  files,
  draftId,
  sourceFileIds = [],
  disabled = false,
  uploading = false,
  onAdd,
  onRename,
  onRemove,
}: Props) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<string>();
  const [renaming, setRenaming] = useState<{
    id: string;
    name: string;
  }>();
  const preview = files.find((file) => file._id === previewId);
  const full = files.length >= MAX_TRANSACTION_FILES;
  const editable = !!onAdd;
  return (
    <section className="movement-attachments" aria-labelledby={`${id}-title`}>
      <div className="movement-section-heading">
        <h2 id={`${id}-title`}>
          Adjuntos {editable && <span>· Opcional</span>}
        </h2>
        {files.length > 0 && (
          <span
            className="movement-file-count"
            aria-label={`${files.length} de ${MAX_TRANSACTION_FILES} archivos`}
          >
            {files.length}/{MAX_TRANSACTION_FILES}
          </span>
        )}
      </div>
      {editable && (
        <p id={`${id}-help`} className="movement-help">
          Se guardan con el movimiento, sin analizar su contenido.
        </p>
      )}
      {files.length > 0 ? (
        <ul className="movement-attachment-list" aria-label="Archivos adjuntos">
          {files.map((file) => {
            const source = sourceFileIds.some((id) => id === file._id);
            const name = file.displayName || file.originalName;
            return (
              <li key={file._id}>
                {source ? (
                  <ReceiptText size={20} aria-hidden="true" />
                ) : (
                  <FileText size={20} aria-hidden="true" />
                )}
                <div className="movement-attachment-name">
                  {renaming?.id === file._id ? (
                    <div className="movement-file-rename">
                      <label htmlFor={`${id}-filename`}>
                        Nombre del archivo
                      </label>
                      <input
                        id={`${id}-filename`}
                        autoFocus
                        maxLength={100}
                        value={renaming.name}
                        disabled={disabled}
                        onChange={(event) =>
                          setRenaming({
                            id: file._id,
                            name: event.target.value,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onRename?.(file._id, renaming.name.trim());
                            setRenaming(undefined);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenaming(undefined);
                          }
                        }}
                      />
                      <div className="movement-inline-actions">
                        <button
                          type="button"
                          className="movement-text-button"
                          disabled={disabled}
                          onClick={() => {
                            onRename?.(file._id, renaming.name.trim());
                            setRenaming(undefined);
                          }}
                        >
                          Guardar nombre
                        </button>
                        <button
                          type="button"
                          className="movement-text-button"
                          disabled={disabled}
                          onClick={() => setRenaming(undefined)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <strong>{name}</strong>
                  )}
                  <small>
                    {"localFile" in file
                      ? "Se subirá al guardar cambios"
                      : source
                        ? "Usado para completar los datos"
                        : formatFileSize(file.sizeBytes)}
                  </small>
                </div>
                <div className="movement-attachment-actions">
                  <button
                    type="button"
                    className="movement-text-button"
                    onClick={() => setPreviewId(file._id)}
                    aria-label={`Ver ${name}`}
                  >
                    Ver
                  </button>
                  {onRename && !renaming && (
                    <button
                      type="button"
                      className="movement-icon-button"
                      disabled={disabled}
                      onClick={() =>
                        setRenaming({
                          id: file._id,
                          name: file.displayName || "",
                        })
                      }
                      aria-label={`Renombrar ${name}`}
                    >
                      <PencilLine size={17} />
                    </button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      className="movement-icon-button"
                      disabled={disabled}
                      onClick={() => {
                        onRemove(file._id);
                        document.getElementById(`${id}-add`)?.focus();
                      }}
                      aria-label={`Quitar ${name}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        !editable && <p className="movement-help">Sin archivos adjuntos.</p>
      )}
      {editable && (
        <>
          <input
            ref={picker}
            type="file"
            accept={TRANSACTION_FILE_ACCEPT}
            multiple
            hidden
            disabled={disabled || full}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length) onAdd(files);
            }}
          />
          <button
            id={`${id}-add`}
            type="button"
            className="button secondary movement-add-files"
            disabled={disabled || full}
            onClick={() => picker.current?.click()}
            aria-describedby={`${id}-help ${id}-limits`}
          >
            {uploading ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <Plus size={18} />
            )}
            {uploading
              ? "Guardando archivos…"
              : full
                ? "Límite de 5 archivos alcanzado"
                : "Agregar archivos"}
          </button>
          <p id={`${id}-limits`} className="movement-help">
            JPG, PNG, WebP, PDF o TXT · Hasta 5 archivos de 2 MB.
          </p>
        </>
      )}
      {preview && (
        <FileViewerDialog
          key={preview._id}
          draftId={draftId}
          file={preview}
          onClose={() => setPreviewId(undefined)}
        />
      )}
    </section>
  );
}
