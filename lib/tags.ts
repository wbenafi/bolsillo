import type { Id } from "@/convex/_generated/dataModel";
import type { TagColor, WalletTransaction } from "@/types/domain";

export const tagColorOptions: ReadonlyArray<{ color: TagColor; label: string }> = [
  { color: "teal", label: "Verde" },
  { color: "blue", label: "Azul" },
  { color: "violet", label: "Violeta" },
  { color: "rose", label: "Rosa" },
  { color: "orange", label: "Naranja" },
  { color: "amber", label: "Ámbar" },
  { color: "slate", label: "Gris" },
];

export function filterTransactionsByTagIds(
  transactions: readonly WalletTransaction[],
  selectedTagIds: readonly Id<"tags">[],
) {
  if (!selectedTagIds.length) return [...transactions];
  const selected = new Set<string>(selectedTagIds);
  return transactions.filter((transaction) =>
    transaction.tagIds?.some((tagId) => selected.has(tagId)),
  );
}
