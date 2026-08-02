import Link from "next/link";

import { TagChip } from "@/components/tag-chip";
import { formatTransactionDate } from "@/lib/date";
import { formatMoney, getTransactionSign } from "@/lib/money";
import type { Currency, WalletTag, WalletTransaction } from "@/types/domain";

type TransactionListProps = {
  transactions: WalletTransaction[];
  currency: Currency;
  tags?: WalletTag[];
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

export function TransactionList({ transactions, currency, tags = [], hasActiveFilters = false, onClearFilters }: TransactionListProps) {
  if (!transactions.length) {
    if (hasActiveFilters) return <div className="empty-movements"><h3>No hay coincidencias</h3><p>Ningún movimiento tiene alguno de los tags seleccionados.</p><button type="button" className="button secondary" onClick={onClearFilters}>Limpiar filtros</button></div>;
    return <div className="empty-movements"><h3>Todavía no hay movimientos</h3><p>Agregá un ingreso o un gasto para comenzar a llevar el saldo de este bolsillo.</p></div>;
  }

  const tagsById = new Map(tags.map((tag) => [tag._id, tag]));

  return (
    <div className="transaction-list">
      {transactions.map((transaction) => (
        <Link
          className="transaction-row"
          href={`/wallets/${transaction.walletId}/transactions/${transaction._id}/edit`}
          key={transaction._id}
        >
          <div className="transaction-copy">
            <h3>{transaction.description}</h3>
            <p>{formatTransactionDate(transaction.date)}{transaction.notes ? ` · ${transaction.notes}` : ""}</p>
            {!!transaction.tagIds?.length && <div className="transaction-tags">{transaction.tagIds.map((tagId) => {
              const tag = tagsById.get(tagId);
              return tag ? <TagChip key={tagId} tag={tag} /> : null;
            })}</div>}
          </div>
          <strong className={`transaction-amount ${transaction.type}`}>
            {getTransactionSign(transaction.type)}{formatMoney(transaction.amountMinor, currency)}
          </strong>
        </Link>
      ))}
    </div>
  );
}
