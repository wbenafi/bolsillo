import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { WalletForm } from "@/components/wallet-form";

export default function NewWalletPage() {
  return <main className="page-shell narrow"><Link className="back-link" href="/"><ArrowLeft /> Volver</Link><section className="page-heading"><p className="eyebrow">Un propósito, un saldo claro</p><h1>Nuevo bolsillo</h1><p>Podés cambiar estos datos cuando querás.</p></section><WalletForm /></main>;
}
