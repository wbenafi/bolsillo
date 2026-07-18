"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { KeyRound, PiggyBank } from "lucide-react";
import { useMemo } from "react";
import { Toaster } from "sonner";

type AppProvidersProps = Readonly<{
  children: React.ReactNode;
  clerkPublishableKey?: string;
  convexUrl?: string;
}>;

function ConfigurationNotice() {
  return (
    <main className="setup-page">
      <section className="setup-card">
        <span className="brand-mark" aria-hidden="true"><PiggyBank size={26} /></span>
        <p className="eyebrow"><KeyRound size={15} /> Configuración pendiente</p>
        <h1>Bolsillo ya está tomando forma</h1>
        <p>
          Agregá las variables de Clerk y Convex en <code>.env.local</code> para iniciar sesión
          y usar tus bolsillos.
        </p>
      </section>
    </main>
  );
}

export function AppProviders({ children, clerkPublishableKey, convexUrl }: AppProvidersProps) {
  const convex = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [convexUrl],
  );

  if (!clerkPublishableKey || !convex) return <ConfigurationNotice />;

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
        <Toaster richColors position="top-center" />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
