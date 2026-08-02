"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { TagDialog } from "@/components/tag-dialog";
import type { Id } from "@/convex/_generated/dataModel";
import type { WalletTag } from "@/types/domain";

type TagSelectorProps = {
  walletId: Id<"wallets">;
  tags: WalletTag[];
  selectedTagIds: Id<"tags">[];
  onChange: (tagIds: Id<"tags">[]) => void;
};

export function TagSelector({ walletId, tags, selectedTagIds, onChange }: TagSelectorProps) {
  const [isCreating, setIsCreating] = useState(false);

  function toggleTag(tagId: Id<"tags">) {
    onChange(selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId]);
  }

  return (
    <div className="field tag-selector-field">
      <div className="field-label-row"><span>Tags <small>Opcional</small></span><button type="button" onClick={() => setIsCreating(true)}><Plus /> Crear tag</button></div>
      {tags.length ? (
        <div className="tag-options" aria-label="Tags del movimiento">
          {tags.map((tag) => (
            <button
              key={tag._id}
              type="button"
              className={`tag-option tag-${tag.color}${selectedTagIds.includes(tag._id) ? " active" : ""}`}
              aria-pressed={selectedTagIds.includes(tag._id)}
              onClick={() => toggleTag(tag._id)}
            >{tag.label}</button>
          ))}
        </div>
      ) : <p className="tag-selector-empty">Creá tu primer tag para clasificar este movimiento.</p>}
      <TagDialog
        open={isCreating}
        walletId={walletId}
        onClose={() => setIsCreating(false)}
        onSaved={(tagId) => onChange([...new Set([...selectedTagIds, tagId])] as Id<"tags">[])}
      />
    </div>
  );
}
