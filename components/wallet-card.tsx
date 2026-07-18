import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";

import { formatTransactionDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { WalletSummary } from "@/types/domain";

export function WalletCard({ wallet }: { wallet: WalletSummary }) {
  return (
    <Link className="wallet-card" href={`/wallets/${wallet._id}`}>
      <div className="wallet-card-main">
        <div>
          <h2>{wallet.name}</h2>
          {wallet.description && <p>{wallet.description}</p>}
        </div>
        <ChevronRight className="chevron" aria-hidden="true" />
      </div>
      <div className="wallet-balance">
        <span>Disponible</span>
        <strong>{formatMoney(wallet.balance, wallet.currency)}</strong>
      </div>
      <div className="wallet-meta">
        <span className="income"><ArrowDownLeft /> {formatMoney(wallet.totalIncome, wallet.currency)}</span>
        <span className="expense"><ArrowUpRight /> {formatMoney(wallet.totalExpense, wallet.currency)}</span>
        <span className="latest">{wallet.latestMovementAt ? `Último: ${formatTransactionDate(wallet.latestMovementAt)}` : "Sin movimientos"}</span>
      </div>
    </Link>
  );
}
