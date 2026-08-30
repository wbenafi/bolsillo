"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Archive, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { TagChip } from "@/components/tag-chip";
import { TagDialog } from "@/components/tag-dialog";
import { LoadingState } from "@/components/ui-states";
import { useFeature } from "@/components/viewer-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import type { WalletSummary, WalletTag } from "@/types/domain";

export default function WalletTagsPage() {
  const { walletId: rawWalletId } = useParams<{ walletId: string }>();
  const walletId = rawWalletId as Id<"wallets">;
  const wallet = useQuery(api.wallets.getWallet, { walletId }) as WalletSummary | undefined;
  const tags = useQuery(api.tags.listTagsByWallet, { walletId }) as WalletTag[] | undefined;
  const deleteTag = useMutation(api.tags.deleteTag);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<WalletTag>();
  const [deletingTagId, setDeletingTagId] = useState<Id<"tags">>();
  const canManageTags = useFeature("tags.manage");

  if (!wallet || !tags) return <main className="page-shell"><LoadingState label="Cargando tags…" /></main>;

  function openCreateDialog() {
    setEditingTag(undefined);
    setDialogOpen(true);
  }

  function openEditDialog(tag: WalletTag) {
    setEditingTag(tag);
    setDialogOpen(true);
  }

  async function removeTag(tag: WalletTag) {
    const usage = tag.usageCount === 1 ? "1 movimiento" : `${tag.usageCount} movimientos`;
    if (!window.confirm(`¿Eliminar el tag “${tag.label}”?\nSe quitará de ${usage}, pero los movimientos se conservarán.`)) return;
    setDeletingTagId(tag._id);
    try {
      await deleteTag({ tagId: tag._id });
      toast.success("Tag eliminado");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletingTagId(undefined);
    }
  }

  return (
    <main className="page-shell tags-page">
      <Link className="back-link" href={`/wallets/${walletId}`}><ArrowLeft /> Volver a {wallet.name}</Link>
      <section className="page-heading split">
        <div><p className="eyebrow">{wallet.name}</p><h1>Tags</h1><p>Organizá las etiquetas disponibles para los movimientos de este bolsillo.</p></div>
        {!wallet.archivedAt && canManageTags && <button type="button" className="button primary" onClick={openCreateDialog}><Plus /> Nuevo tag</button>}
      </section>
      {!canManageTags && <div className="archived-notice">Podés consultar los tags existentes, pero su administración está deshabilitada para esta cuenta.</div>}
      {wallet.archivedAt && <div className="archived-notice"><Archive /> Este bolsillo está archivado. Restauralo para modificar sus tags.</div>}
      {tags.length ? (
        <div className="tag-management-list">
          {tags.map((tag) => (
            <article key={tag._id}>
              <div className="tag-management-copy">
                <TagChip tag={tag} />
                {tag.description && <p>{tag.description}</p>}
                <small>{tag.usageCount} {tag.usageCount === 1 ? "movimiento" : "movimientos"}</small>
              </div>
              {!wallet.archivedAt && canManageTags && (
                <div className="tag-management-actions">
                  <button type="button" className="icon-link" aria-label={`Editar ${tag.label}`} onClick={() => openEditDialog(tag)}><Pencil /></button>
                  <button type="button" className="icon-link destructive" aria-label={`Eliminar ${tag.label}`} onClick={() => removeTag(tag)} disabled={deletingTagId === tag._id}>
                    {deletingTagId === tag._id ? <LoaderCircle className="spin" /> : <Trash2 />}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-movements"><h3>Todavía no hay tags</h3><p>Creá etiquetas para clasificar y filtrar los movimientos de este bolsillo.</p>{!wallet.archivedAt && canManageTags && <button type="button" className="button primary" onClick={openCreateDialog}><Plus /> Crear primer tag</button>}</div>
      )}
      {canManageTags && <TagDialog
        open={dialogOpen}
        walletId={walletId}
        tag={editingTag}
        onClose={() => setDialogOpen(false)}
      />}
    </main>
  );
}
