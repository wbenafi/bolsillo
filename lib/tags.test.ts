import { describe, expect, it } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";
import type { WalletTransaction } from "@/types/domain";
import { tagSchema } from "./validators";
import { filterTransactionsByTagIds } from "./tags";

const tagA = "tag-a" as Id<"tags">;
const tagB = "tag-b" as Id<"tags">;
const transactions = [
  { _id: "one", tagIds: [tagA] },
  { _id: "two", tagIds: [tagB] },
  { _id: "both", tagIds: [tagA, tagB] },
  { _id: "none" },
] as WalletTransaction[];

describe("filterTransactionsByTagIds", () => {
  it("returns every movement without active filters", () => {
    expect(filterTransactionsByTagIds(transactions, [])).toHaveLength(4);
  });

  it("matches any selected tag using OR semantics", () => {
    expect(filterTransactionsByTagIds(transactions, [tagA, tagB]).map(({ _id }) => _id))
      .toEqual(["one", "two", "both"]);
  });

  it("does not include untagged movements in a tag filter", () => {
    expect(filterTransactionsByTagIds(transactions, [tagA]).map(({ _id }) => _id))
      .toEqual(["one", "both"]);
  });

  it("returns an empty result when no movement has the selected tag", () => {
    const missingTag = "missing" as Id<"tags">;
    expect(filterTransactionsByTagIds(transactions, [missingTag])).toEqual([]);
  });
});

describe("tagSchema", () => {
  it("accepts the supported palette and an empty optional description", () => {
    expect(tagSchema.safeParse({ label: "Materiales", color: "violet", description: "" }).success).toBe(true);
  });

  it("rejects empty labels, unsupported colors and long descriptions", () => {
    expect(tagSchema.safeParse({ label: " ", color: "violet", description: "" }).success).toBe(false);
    expect(tagSchema.safeParse({ label: "Casa", color: "green", description: "" }).success).toBe(false);
    expect(tagSchema.safeParse({ label: "Casa", color: "teal", description: "x".repeat(241) }).success).toBe(false);
  });
});
