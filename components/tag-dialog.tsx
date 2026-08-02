"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { tagColorOptions } from "@/lib/tags";
import { tagSchema, type TagFormValues } from "@/lib/validators";
import type { WalletTag } from "@/types/domain";

type TagDialogProps = {
  open: boolean;
  walletId: Id<"wallets">;
  tag?: WalletTag;
  onClose: () => void;
  onSaved?: (tagId: Id<"tags">) => void;
};

export function TagDialog({ open, walletId, tag, onClose, onSaved }: TagDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const createTag = useMutation(api.tags.createTag);
  const updateTag = useMutation(api.tags.updateTag);
  const { register, handleSubmit, reset, control, setValue, formState: { errors, isSubmitting } } = useForm<TagFormValues>({
    resolver: zodResolver(tagSchema),
    defaultValues: { label: "", color: "teal", description: "" },
  });
  const selectedColor = useWatch({ control, name: "color" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    reset({ label: tag?.label ?? "", color: tag?.color ?? "teal", description: tag?.description ?? "" });
    if (!dialog.open) dialog.showModal();
  }, [open, reset, tag]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const payload = {
        label: values.label.trim(),
        color: values.color,
        description: values.description.trim() || undefined,
      };
      let savedTagId: Id<"tags">;
      if (tag) {
        await updateTag({ tagId: tag._id, ...payload });
        savedTagId = tag._id;
        toast.success("Tag actualizado");
      } else {
        savedTagId = await createTag({ walletId, ...payload });
        toast.success("Tag creado");
      }
      onSaved?.(savedTagId);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="tag-dialog"
      aria-labelledby="tag-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!isSubmitting) onClose(); }}
      onClose={() => { if (open && !isSubmitting) onClose(); }}
    >
      <form className="tag-dialog-card" onSubmit={(event) => { event.stopPropagation(); void onSubmit(event); }} noValidate>
        <div className="dialog-heading">
          <div><p className="eyebrow">Tag</p><h2 id="tag-dialog-title">{tag ? "Editar tag" : "Nuevo tag"}</h2></div>
          <button type="button" className="icon-link" aria-label="Cerrar" onClick={onClose} disabled={isSubmitting}><X /></button>
        </div>
        <div className="field">
          <label htmlFor="tag-label">Label</label>
          <input id="tag-label" autoFocus maxLength={40} placeholder="Ej. Materiales" {...register("label")} />
          {errors.label && <p className="field-error">{errors.label.message}</p>}
        </div>
        <fieldset className="color-picker">
          <legend>Color</legend>
          {tagColorOptions.map((option) => (
            <button
              key={option.color}
              type="button"
              className={`color-option tag-${option.color}${selectedColor === option.color ? " active" : ""}`}
              aria-label={option.label}
              aria-pressed={selectedColor === option.color}
              onClick={() => setValue("color", option.color, { shouldValidate: true })}
            ><span /></button>
          ))}
          <input type="hidden" {...register("color")} />
        </fieldset>
        <div className="field">
          <label htmlFor="tag-description">Descripción <span>Opcional</span></label>
          <textarea id="tag-description" rows={3} maxLength={240} placeholder="¿Cuándo usás este tag?" {...register("description")} />
          {errors.description && <p className="field-error">{errors.description.message}</p>}
        </div>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={isSubmitting}>Cancelar</button>
          <button type="submit" className="button primary" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="spin" size={18} />}
            {tag ? "Guardar cambios" : "Crear tag"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
