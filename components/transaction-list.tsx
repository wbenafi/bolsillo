import Link from "next/link";

import { formatTransactionDate } from "@/lib/date";
import { formatMoney, getTransactionSign } from "@/lib/money";
import type { Currency, WalletTransaction } from "@/types/domain";

export function TransactionList({ transactions, currency }: { transactions: WalletTransaction[]; currency: Currency }) {
  if (!transactions.length) {
    return <div className="empty-movements"><h3>Todavía no hay movimientos</h3><p>Agregá un ingreso o un gasto para comenzar a llevar el saldo de este bolsillo.</p></div>;
  }

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
          </div>
          <strong className={`transaction-amount ${transaction.type}`}>
            {getTransactionSign(transaction.type)}{formatMoney(transaction.amountMinor, currency)}
          </strong>
        </Link>
      ))}
    </div>
  );
}
