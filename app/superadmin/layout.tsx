"use client";

import { LayoutDashboard, ScrollText, ShieldX, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useViewer } from "@/components/viewer-context";

export default function SuperadminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const viewer = useViewer();
  const pathname = usePathname();

  if (viewer.user.platformRole !== "superadmin") {
    return (
      <main className="page-shell">
        <div className="state-card error">
          <ShieldX />
          <h1>Acceso restringido</h1>
          <p>No tenés permiso para acceder a la administración de Bolsillo.</p>
          <Link className="button secondary" href="/">Volver a tus bolsillos</Link>
        </div>
      </main>
    );
  }

  const accountSection = pathname === "/superadmin" || pathname.startsWith("/superadmin/accounts");
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div>
          <p className="eyebrow"><LayoutDashboard /> Control de plataforma</p>
          <h1>Superadmin</h1>
        </div>
        <nav aria-label="Administración">
          <Link className={accountSection ? "active" : ""} href="/superadmin">
            <Users /> Cuentas
          </Link>
          <Link className={pathname.startsWith("/superadmin/audit") ? "active" : ""} href="/superadmin/audit">
            <ScrollText /> Auditoría
          </Link>
        </nav>
      </aside>
      <div className="admin-content">{children}</div>
    </div>
  );
}
