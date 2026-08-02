import type { WalletTag } from "@/types/domain";

export function TagChip({ tag }: { tag: Pick<WalletTag, "label" | "color"> }) {
  return <span className={`tag-chip tag-${tag.color}`}>{tag.label}</span>;
}
