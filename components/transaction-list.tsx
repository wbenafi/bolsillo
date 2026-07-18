"use client";

import { useMutation } from "convex/react";
import { ArrowDownLeft, ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { formatTransactionDate } from "@/lib/date";
import { errorMessage } from "@/lib/errors";
import { formatMoney, getTransactionSign } from "@/lib/money";
import type { Currency, WalletTransaction } from "@/types/domain";

export function TransactionList({ transactions, currency }: { transactions: WalletTransaction[]; currency: Currency }) {
  const deleteTransaction = useMutation(api.transactions.deleteTransaction);

  async function remove(transaction: WalletTransaction) {
    if (!window.confirm("¿Eliminar este movimiento?\nEsta acción cambiará el saldo del bolsillo.")) return;
    try {
      await deleteTransaction({ transactionId: transaction._id });
      toast.success("Movimiento eliminado");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  if (!transactions.length) {
    return <div className="empty-movements"><h3>Todavía no hay movimientos</h3><p>Agregá un ingreso o un gasto para comenzar a llevar el saldo de este bolsillo.</p></div>;
  }

  return (
    <div className="transaction-list">
      {transactions.map((transaction) => (
        <article className="transaction-row" key={transaction._id}>
          <span className={`transaction-icon ${transaction.type}`} aria-hidden="true">
            {transaction.type === "income" ? <ArrowDownLeft /> : <ArrowUpRight />}
          </span>
          <div className="transaction-copy">
            <h3>{transaction.description}</h3>
            <p>{formatTransactionDate(transaction.date)}{transaction.notes ? ` · ${transaction.notes}` : ""}</p>
          </div>
          <strong className={`transaction-amount ${transaction.type}`}>
            {getTransactionSign(transaction.type)}{formatMoney(transaction.amountMinor, currency)}
          </strong>
          <div className="row-actions">
            <Link href={`/wallets/${transaction.walletId}/transactions/${transaction._id}/edit`} aria-label={`Editar ${transaction.description}`}><Pencil /></Link>
            <button type="button" onClick={() => remove(transaction)} aria-label={`Eliminar ${transaction.description}`}><Trash2 /></button>
          </div>
        </article>
      ))}
    </div>
  );
}
