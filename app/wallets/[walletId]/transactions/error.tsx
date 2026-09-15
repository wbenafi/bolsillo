"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function TransactionError({ reset }: { reset: () => void }) {
  const { walletId } = useParams<{ walletId: string }>();
  return (
    <main className="page-shell narrow">
      <div className="form-card movement-unavailable">
        <h1>No pudimos abrir el movimiento</h1>
        <p>
          Puede haber cambiado, vencido o ya no estar disponible para tu cuenta.
        </p>
        <div className="movement-inline-actions">
          <button type="button" className="button primary" onClick={reset}>
            Reintentar
          </button>
          <Link className="button secondary" href={`/wallets/${walletId}`}>
            Volver al bolsillo
          </Link>
        </div>
      </div>
    </main>
  );
}
