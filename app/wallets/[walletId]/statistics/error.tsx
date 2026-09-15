"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui-states";

export default function StatisticsError({ reset }: { reset: () => void }) {
  return <main className="page-shell"><ErrorState message="Revisá tu conexión y comprobá que el bolsillo siga disponible en tu cuenta." /><div className="statistics-error-actions"><button className="button primary" onClick={reset}>Reintentar</button><Link className="button secondary" href="/">Volver a los bolsillos</Link></div></main>;
}
