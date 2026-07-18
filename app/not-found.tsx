import { CircleHelp } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return <main className="page-shell"><div className="state-card"><span className="state-icon"><CircleHelp /></span><h1>No encontramos este bolsillo</h1><p>Puede que se haya eliminado o que no tengás acceso.</p><Link className="button primary" href="/">Volver a mis bolsillos</Link></div></main>;
}
