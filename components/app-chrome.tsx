"use client";

import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { ViewerProvider } from "@/components/viewer-context";
import { ErrorState, LoadingState } from "@/components/ui-states";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import type { Viewer } from "@/types/domain";

function SessionLoading() {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!timedOut) return <LoadingState label="Verificando tu sesión…" />;
  return (
    <div className="state-card">
      <h2>La conexión está tardando</h2>
      <p>No pudimos conectar con tus bolsillos. Revisá tu conexión e intentá de nuevo.</p>
      <button className="button primary" onClick={() => window.location.reload()}>Reintentar</button>
    </div>
  );
}

export function AppChrome({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");
  const { isLoading, isAuthenticated } = useConvexAuth();
  const viewer = useQuery(
    api.users.current,
    isAuthPage || !isAuthenticated ? "skip" : {},
  ) as Viewer | null | undefined;
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const [setupError, setSetupError] = useState<string>();
  const ensuredSession = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      ensuredSession.current = false;
      return;
    }
    if (ensuredSession.current || setupError) return;
    ensuredSession.current = true;
    void ensureCurrent({}).catch((error) => setSetupError(errorMessage(error)));
  }, [ensureCurrent, isAuthenticated, setupError]);

  if (isAuthPage) return children;

  if (isLoading) {
    return (
      <main className="page-shell">
        <SessionLoading />
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

  if (setupError) {
    return <main className="page-shell"><ErrorState message={setupError} /></main>;
  }

  if (!viewer) {
    return <main className="page-shell"><LoadingState label="Preparando tu cuenta…" /></main>;
  }

  const isSuperadminRoute = pathname.startsWith("/superadmin");
  const suspended = viewer.account.status === "suspended" && !isSuperadminRoute;

  return (
    <ViewerProvider viewer={viewer}>
      <AppHeader viewer={viewer} />
      {suspended ? (
        <main className="page-shell">
          <ErrorState
            message={viewer.account.suspendedReason
              ? `Esta cuenta está suspendida: ${viewer.account.suspendedReason}`
              : "Esta cuenta está suspendida. Contactá al equipo de Bolsillo para obtener ayuda."}
          />
        </main>
      ) : children}
    </ViewerProvider>
  );
}
