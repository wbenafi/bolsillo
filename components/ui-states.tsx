import { CircleAlert, LoaderCircle, WalletCards } from "lucide-react";
import Link from "next/link";

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return <div className="state-card compact"><LoaderCircle className="spin" /><p>{label}</p></div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state-card error"><CircleAlert /><h2>No pudimos cargar esta información</h2><p>{message}</p></div>;
}

export function FeatureUnavailable({ message }: { message: string }) {
  return <div className="state-card"><CircleAlert /><h2>Función no disponible</h2><p>{message}</p><Link className="button secondary" href="/">Volver a los bolsillos</Link></div>;
}

export function EmptyWallets({ canCreate = true }: { canCreate?: boolean }) {
  return (
    <div className="state-card">
      <span className="state-icon"><WalletCards /></span>
      <h2>Creá tu primer bolsillo</h2>
      <p>Separá el dinero de un proyecto o propósito y llevá el control de todo lo que entra y sale.</p>
      {canCreate && <Link className="button primary" href="/wallets/new">Crear bolsillo</Link>}
    </div>
  );
}
