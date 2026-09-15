import Link from "next/link";
import { ChartNoAxesCombined, List } from "lucide-react";

export function WalletTabs({ walletId, active }: { walletId: string; active: "movements" | "statistics" }) {
  return (
    <nav className="wallet-tabs" aria-label="Secciones del bolsillo">
      <Link href={`/wallets/${walletId}`} aria-current={active === "movements" ? "page" : undefined}><List size={18} /> Movimientos</Link>
      <Link href={`/wallets/${walletId}/statistics`} aria-current={active === "statistics" ? "page" : undefined}><ChartNoAxesCombined size={18} /> Estadísticas</Link>
    </nav>
  );
}
