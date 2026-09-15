"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export function MovementConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Conservar y volver",
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="movement-confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-copy`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        type="button"
        className="movement-icon-button movement-dialog-close"
        aria-label="Cerrar"
        disabled={busy}
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-copy`}>{children}</div>
      {error && (
        <p className="movement-error" role="alert">
          {error}
        </p>
      )}
      <div className="movement-dialog-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
          autoFocus
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="button destructive"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && <LoaderCircle className="spin" size={18} />}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
