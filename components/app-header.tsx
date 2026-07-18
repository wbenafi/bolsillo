"use client";

import { UserButton } from "@clerk/nextjs";
import { Archive, PiggyBank } from "lucide-react";
import Link from "next/link";

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="Bolsillo, ir al inicio">
          <span className="brand-mark" aria-hidden="true"><PiggyBank size={23} /></span>
          <span>Bolsillo</span>
        </Link>
        <nav className="header-actions" aria-label="Navegación principal">
          <Link className="icon-link" href="/archived" aria-label="Bolsillos archivados">
            <Archive size={20} />
          </Link>
          <UserButton />
        </nav>
      </div>
    </header>
  );
}
