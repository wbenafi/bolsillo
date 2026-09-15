import { describe, expect, it } from "vitest";
import { amountChange, boundedGroup, buildTrend, lastDaysRange, MAX_STATISTICS_DAYS, periodTotals, previousRange, rangeDays, rangeError, tagBreakdown } from "./statistics";

describe("statistics calendar ranges", () => {
  it("includes today and crosses leap days and year boundaries", () => {
    expect(lastDaysRange("2024-03-01", 3)).toEqual({ start: "2024-02-28", end: "2024-03-01" });
    expect(lastDaysRange("2026-01-02", 7)).toEqual({ start: "2025-12-27", end: "2026-01-02" });
    expect(rangeDays({ start: "2026-03-07", end: "2026-03-09" })).toBe(3);
  });
  it("compares adjacent equal-length periods without overlapping boundaries", () => {
    expect(previousRange({ start: "2026-09-01", end: "2026-09-13" })).toEqual({ start: "2026-08-19", end: "2026-08-31" });
    expect(previousRange({ start: "2026-01-01", end: "2026-01-01" })).toEqual({ start: "2025-12-31", end: "2025-12-31" });
  });
  it.each([
    { start: "2026-02-29", end: "2026-03-01" },
    { start: "2026-09-31", end: "2026-10-01" },
    { start: "", end: "2026-09-13" },
    { start: "2026-09-14", end: "2026-09-13" },
    { start: "2000-01-01", end: "2026-09-13" },
    { start: "0001-01-01", end: "0001-01-02" },
  ])("rejects invalid or unsupported ranges: %j", range => {
    expect(rangeError(range)).toBeTypeOf("string");
  });
});

describe("statistics totals and comparisons", () => {
  it("uses all calendar days in the average and preserves USD cents", () => {
    expect(periodTotals([
      { type: "income", amountMinor: 10000, date: "2026-09-01" },
      { type: "expense", amountMinor: 101, date: "2026-09-01" },
      { type: "expense", amountMinor: 202, date: "2026-09-03" },
    ], 7)).toEqual({ income: 10000, expense: 303, net: 9697, dailyExpense: 303 / 7, count: 3 });
    expect(periodTotals([], 30)).toEqual({ income: 0, expense: 0, net: 0, dailyExpense: 0, count: 0 });
  });
  it("supports negative net cash flow and a zero comparison baseline", () => {
    expect(periodTotals([{ type: "expense", amountMinor: 150, date: "2026-09-01" }], 1).net).toBe(-150);
    expect(amountChange(150, 0)).toEqual({ amount: 150, percent: null });
    expect(amountChange(0, 0)).toEqual({ amount: 0, percent: null });
    expect(amountChange(0, 100)).toEqual({ amount: -100, percent: -100 });
    expect(amountChange(118, 100)).toEqual({ amount: 18, percent: 18 });
  });
});

describe("trend and tag charts", () => {
  it.each([
    [90, "day", "day"], [91, "day", "week"],
    [730, "day", "week"], [730, "week", "week"],
    [731, "day", "month"], [731, "week", "month"],
    [7, "month", "month"], [7, "week", "week"],
  ] as const)("bounds a %i-day %s request to %s", (days, requested, expected) => {
    const range = lastDaysRange("2026-09-13", days);
    expect(boundedGroup(range, requested)).toBe(expected);
  });
  it("bounds the longest report for every grouping and preserves totals and date coverage", () => {
    const range = lastDaysRange("2026-09-13", MAX_STATISTICS_DAYS);
    const transactions = [
      { type: "income" as const, amountMinor: 10001, date: range.start },
      { type: "expense" as const, amountMinor: 303, date: "2024-02-29" },
      { type: "expense" as const, amountMinor: 101, date: range.end },
    ];
    for (const group of ["day", "week", "month"] as const) {
      const buckets = buildTrend(transactions, range, group);
      expect(buckets.length).toBeLessThanOrEqual(122);
      expect(buckets[0].start).toBe(range.start);
      expect(buckets.at(-1)?.end).toBe(range.end);
      expect(buckets.reduce((days, bucket) => days + rangeDays(bucket), 0)).toBe(MAX_STATISTICS_DAYS);
      expect(buckets.reduce((sum, bucket) => sum + bucket.income, 0)).toBe(10001);
      expect(buckets.reduce((sum, bucket) => sum + bucket.expense, 0)).toBe(404);
      expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    }
  });
  it("fills missing dates, excludes outside records and sorts input", () => {
    const buckets = buildTrend([
      { type: "expense", amountMinor: 300, date: "2026-09-03" },
      { type: "income", amountMinor: 1000, date: "2026-09-01" },
      { type: "expense", amountMinor: 900, date: "2026-08-31" },
      { type: "expense", amountMinor: 900, date: "2026-09-04" },
    ], { start: "2026-09-01", end: "2026-09-03" }, "day");
    expect(buckets.map(bucket => [bucket.income, bucket.expense, bucket.count])).toEqual([[1000, 0, 1], [0, 0, 0], [0, 300, 1]]);
  });
  it("clips calendar weeks and months to the selected dates", () => {
    const range = { start: "2026-08-30", end: "2026-09-08" };
    expect(buildTrend([], range, "week").map(({ start, end }) => [start, end])).toEqual([
      ["2026-08-30", "2026-08-30"], ["2026-08-31", "2026-09-06"], ["2026-09-07", "2026-09-08"],
    ]);
    expect(buildTrend([], range, "month").map(({ start, end }) => [start, end])).toEqual([
      ["2026-08-30", "2026-08-31"], ["2026-09-01", "2026-09-08"],
    ]);
    expect(buildTrend([], { start: "9999-12-31", end: "9999-12-31" }, "day")).toHaveLength(1);
  });
  it("keeps overlapping tags separate, deduplicates tags, and groups missing tags", () => {
    const transactions = [
      { type: "expense" as const, amountMinor: 100, date: "2026-09-01", tagIds: ["food", "trip", "food"] },
      { type: "expense" as const, amountMinor: 30, date: "2026-09-01" },
      { type: "expense" as const, amountMinor: 20, date: "2026-09-01", tagIds: ["deleted"] },
      { type: "income" as const, amountMinor: 500, date: "2026-09-01", tagIds: ["food"] },
    ];
    expect(tagBreakdown(transactions, ["food", "trip"], "expense")).toEqual({ overlapping: true, rows: [
      { tagId: "food", amount: 100, count: 1 }, { tagId: "trip", amount: 100, count: 1 }, { tagId: null, amount: 50, count: 2 },
    ] });
    expect(periodTotals(transactions, 1).expense).toBe(150);
    expect(tagBreakdown(transactions, ["food", "trip"], "income")).toEqual({ overlapping: false, rows: [{ tagId: "food", amount: 500, count: 1 }] });
  });
});
