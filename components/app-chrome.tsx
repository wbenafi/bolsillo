"use client";

import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/app-header";

export function AppChrome({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");
  return <>{!isAuthPage && <AppHeader />}{children}</>;
}
