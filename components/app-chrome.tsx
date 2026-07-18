"use client";

import { useConvexAuth } from "convex/react";
import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { ErrorState, LoadingState } from "@/components/ui-states";

export function AppChrome({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isAuthPage) return children;

  if (isLoading) {
    return (
      <main className="page-shell">
        <LoadingState label="Verificando tu sesión…" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="page-shell">
        <ErrorState message="No pudimos verificar tu sesión. Volvé a iniciar sesión e intentá de nuevo." />
      </main>
    );
  }

  return <><AppHeader />{children}</>;
}
