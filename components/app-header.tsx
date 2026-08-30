"use client";

import { UserButton } from "@clerk/nextjs";
import { Archive, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { BrandIcon } from "@/components/brand-icon";
import type { Viewer } from "@/types/domain";

export function AppHeader({ viewer }: { viewer: Viewer }) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="Bolsillo, ir al inicio">
          <BrandIcon priority />
          <span>Bolsillo</span>
        </Link>
        <nav className="header-actions" aria-label="Navegación principal">
          {viewer.user.platformRole === "superadmin" && (
            <Link className="icon-link" href="/superadmin" aria-label="Administración">
              <ShieldCheck size={20} />
            </Link>
          )}
          <Link className="icon-link" href="/archived" aria-label="Bolsillos archivados">
            <Archive size={20} />
          </Link>
          <UserButton />
        </nav>
      </div>
    </header>
  );
}
