import { describe, expect, it } from "vitest";

import { featureIsEnabled, resolveFeatureAccess } from "./features";

describe("feature access", () => {
  it("defaults existing features to enabled and movement files to disabled", () => {
    const features = resolveFeatureAccess([]);
    expect(features.find(({ key }) => key === "transactions.files")).toMatchObject({
      enabled: false,
      overridden: false,
    });
    expect(
      features
        .filter(({ key }) => key !== "transactions.files")
        .every((feature) => feature.enabled && !feature.overridden),
    ).toBe(true);
  });

  it("applies an account override and optional limit", () => {
    const features = resolveFeatureAccess([
      { featureKey: "wallets.create", enabled: true, limit: 2 },
      { featureKey: "tags.manage", enabled: false },
    ]);

    expect(features.find(({ key }) => key === "wallets.create")).toMatchObject({
      enabled: true,
      limit: 2,
      overridden: true,
    });
    expect(featureIsEnabled(features, "tags.manage")).toBe(false);
  });

  it("ignores unknown stored keys when resolving the current catalog", () => {
    const features = resolveFeatureAccess([{ featureKey: "retired.feature", enabled: false }]);
    expect(features).toHaveLength(5);
    expect(features.find(({ key }) => key === "transactions.files")?.enabled).toBe(false);
  });
});
