"use client";

import { createContext, useContext } from "react";

import type { FeatureKey } from "@/lib/features";
import { featureIsEnabled } from "@/lib/features";
import type { Viewer } from "@/types/domain";

const ViewerContext = createContext<Viewer | null>(null);

export function ViewerProvider({
  viewer,
  children,
}: Readonly<{ viewer: Viewer; children: React.ReactNode }>) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export function useViewer() {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error("useViewer must be used inside ViewerProvider");
  return viewer;
}

export function useFeature(featureKey: FeatureKey) {
  return featureIsEnabled(useViewer().features, featureKey);
}
