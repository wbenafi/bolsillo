export const FEATURE_DEFINITIONS = [
  {
    key: "wallets.create",
    name: "Crear bolsillos",
    description: "Permite crear nuevos bolsillos. El límite opcional restringe cuántos pueden estar activos.",
    supportsLimit: true,
    defaultEnabled: true,
  },
  {
    key: "transactions.manage",
    name: "Administrar movimientos",
    description: "Permite crear, editar y eliminar ingresos y gastos.",
    supportsLimit: false,
    defaultEnabled: true,
  },
  {
    key: "tags.manage",
    name: "Administrar tags",
    description: "Permite crear, editar y eliminar tags de los bolsillos.",
    supportsLimit: false,
    defaultEnabled: true,
  },
  {
    key: "wallets.share",
    name: "Compartir resúmenes",
    description: "Permite generar y compartir la imagen resumen de un bolsillo.",
    supportsLimit: false,
    defaultEnabled: true,
  },
  {
    key: "transactions.files",
    name: "Archivos en movimientos",
    description: "Permite adjuntar y consultar archivos privados en ingresos y gastos.",
    supportsLimit: false,
    defaultEnabled: false,
  },
] as const;

export type FeatureKey = (typeof FEATURE_DEFINITIONS)[number]["key"];

export type ResolvedFeature = {
  key: FeatureKey;
  enabled: boolean;
  limit?: number;
  overridden: boolean;
};

export const DEFAULT_FEATURE_ACCESS = Object.fromEntries(
  FEATURE_DEFINITIONS.map(({ key, defaultEnabled }) => [key, defaultEnabled]),
) as Record<FeatureKey, boolean>;

export function isFeatureKey(value: string): value is FeatureKey {
  return FEATURE_DEFINITIONS.some(({ key }) => key === value);
}

export function resolveFeatureAccess(
  overrides: ReadonlyArray<{ featureKey: string; enabled: boolean; limit?: number }>,
): ResolvedFeature[] {
  const byKey = new Map(overrides.map((override) => [override.featureKey, override]));
  return FEATURE_DEFINITIONS.map(({ key }) => {
    const override = byKey.get(key);
    return {
      key,
      enabled: override?.enabled ?? DEFAULT_FEATURE_ACCESS[key],
      limit: override?.limit,
      overridden: Boolean(override),
    };
  });
}

export function featureIsEnabled(
  features: ReadonlyArray<Pick<ResolvedFeature, "key" | "enabled">>,
  key: FeatureKey,
) {
  return features.find((feature) => feature.key === key)?.enabled ?? DEFAULT_FEATURE_ACCESS[key];
}
