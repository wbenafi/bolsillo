import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "statistics-owner" });
  await owner.mutation(api.users.ensureCurrent, {});
  const walletId = await owner.mutation(api.wallets.createWallet, { name: "Casa", currency: "CRC" });
  const otherWalletId = await owner.mutation(api.wallets.createWallet, { name: "Dólares", currency: "USD" });
  const food = await owner.mutation(api.tags.createTag, { walletId, label: "Comida", color: "teal" });
  const trip = await owner.mutation(api.tags.createTag, { walletId, label: "Viaje", color: "blue" });
  for (const transaction of [
    { date: "2026-08-24", type: "expense" as const, amountMinor: 99999 },
    { date: "2026-08-25", type: "expense" as const, amountMinor: 100 },
    { date: "2026-08-31", type: "income" as const, amountMinor: 300 },
    { date: "2026-09-01", type: "income" as const, amountMinor: 1000 },
    { date: "2026-09-07", type: "expense" as const, amountMinor: 150, tagIds: [food, trip] },
    { date: "2026-09-07", type: "expense" as const, amountMinor: 50 },
    { date: "2026-09-08", type: "expense" as const, amountMinor: 88888 },
  ]) await owner.mutation(api.transactions.createTransaction, { walletId, description: "Registro de prueba", ...transaction });
  await owner.mutation(api.transactions.createTransaction, { walletId: otherWalletId, date: "2026-09-01", type: "expense", amountMinor: 99999, description: "Otro bolsillo" });
  const args = { walletId, start: "2026-09-01", end: "2026-09-07", group: "day" as const };
  return { t, owner, walletId, otherWalletId, food, trip, args };
}

describe("wallet statistics queries", () => {
  it("isolates the wallet, includes exact boundaries and compares the preceding seven days", async () => {
    const d = await setup();
    const result = await d.owner.query(api.transactions.getWalletStatistics, d.args);
    expect(result.current).toMatchObject({ income: 1000, expense: 200, net: 800, dailyExpense: 200 / 7, count: 3 });
    expect(result.previous).toMatchObject({ start: "2026-08-25", end: "2026-08-31", income: 300, expense: 100, count: 2 });
    expect(result.wallet.currency).toBe("CRC");
    expect(result.comparisonAvailable).toBe(true);
    expect(result.trend).toHaveLength(7);
    expect(result.breakdown.expense.overlapping).toBe(true);
    expect(result.breakdown.expense.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(350);
  });
  it("enforces identity, wallet ownership and account suspension for both endpoints", async () => {
    const d = await setup();
    const stranger = d.t.withIdentity({ subject: "statistics-stranger" });
    await stranger.mutation(api.users.ensureCurrent, {});
    const listArgs = { walletId: d.walletId, start: d.args.start, end: d.args.end, paginationOpts: { cursor: null, numItems: 30 } };
    await expect(d.t.query(api.transactions.getWalletStatistics, d.args)).rejects.toThrow();
    await expect(stranger.query(api.transactions.getWalletStatistics, d.args)).rejects.toThrow();
    await expect(stranger.query(api.transactions.listStatisticsTransactions, listArgs)).rejects.toThrow();
    const viewer = (await d.owner.query(api.users.current, {}))!;
    await d.t.run(ctx => ctx.db.patch(viewer.account._id, { status: "suspended" }));
    await expect(d.owner.query(api.transactions.getWalletStatistics, d.args)).rejects.toThrow();
    await expect(d.owner.query(api.transactions.listStatisticsTransactions, listArgs)).rejects.toThrow();
  });
  it("supports archived wallets, empty periods, and insufficient recorded history", async () => {
    const d = await setup();
    await d.owner.mutation(api.wallets.archiveWallet, { walletId: d.walletId });
    expect((await d.owner.query(api.transactions.getWalletStatistics, d.args)).current.expense).toBe(200);
    const empty = await d.owner.query(api.transactions.getWalletStatistics, { ...d.args, start: "2026-07-01", end: "2026-07-07" });
    expect(empty.current.count).toBe(0);
    expect(empty.comparisonAvailable).toBe(false);
    const partial = await d.owner.query(api.transactions.getWalletStatistics, { ...d.args, walletId: d.otherWalletId });
    expect(partial.comparisonAvailable).toBe(false);
    expect(partial.wallet.currency).toBe("USD");
  });
  it("reflects edits and deletions in totals and tag breakdowns", async () => {
    const d = await setup();
    const transactionId = await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, type: "expense", amountMinor: 123, date: "2026-09-02", description: "Compra", tagIds: [d.food] });
    expect((await d.owner.query(api.transactions.getWalletStatistics, d.args)).current.expense).toBe(323);
    await d.owner.mutation(api.transactions.updateTransaction, { transactionId, type: "expense", amountMinor: 456, date: "2026-09-02", description: "Compra editada" });
    expect((await d.owner.query(api.transactions.getWalletStatistics, d.args)).current.expense).toBe(656);
    await d.owner.mutation(api.transactions.deleteTransaction, { transactionId });
    expect((await d.owner.query(api.transactions.getWalletStatistics, d.args)).current.expense).toBe(200);
  });
  it("drills into type and tag filters, supports untagged records and hides file metadata", async () => {
    const d = await setup();
    const args = { walletId: d.walletId, start: d.args.start, end: d.args.end, paginationOpts: { cursor: null, numItems: 30 } };
    const all = await d.owner.query(api.transactions.listStatisticsTransactions, args);
    expect(all.page).toHaveLength(3);
    expect(all.page.map(transaction => transaction.date)).toEqual(["2026-09-07", "2026-09-07", "2026-09-01"]);
    const tagged = await d.owner.query(api.transactions.listStatisticsTransactions, { ...args, type: "expense", tagId: d.food });
    expect(tagged.page.map(transaction => transaction.amountMinor)).toEqual([150]);
    const untagged = await d.owner.query(api.transactions.listStatisticsTransactions, { ...args, type: "expense", tagId: null });
    expect(untagged.page.map(transaction => transaction.amountMinor)).toEqual([50]);
    expect(all.page.every(transaction => !("fileCount" in transaction))).toBe(true);
    const foreignTag = await d.owner.mutation(api.tags.createTag, { walletId: d.otherWalletId, label: "Otro", color: "teal" });
    await expect(d.owner.query(api.transactions.listStatisticsTransactions, { ...args, tagId: foreignTag })).rejects.toThrow("no pertenece");
  });
  it("preserves pagination cursors when a tag produces an empty page", async () => {
    const d = await setup();
    const args = { walletId: d.walletId, start: d.args.start, end: d.args.end, type: "expense" as const, tagId: d.food };
    const otherTag = await d.owner.mutation(api.tags.createTag, { walletId: d.walletId, label: "Otros", color: "slate" });
    await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, date: "2026-09-07", type: "expense", amountMinor: 1, description: "Más reciente", tagIds: [otherTag] });
    const first = await d.owner.query(api.transactions.listStatisticsTransactions, { ...args, paginationOpts: { cursor: null, numItems: 1 } });
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const next = await d.owner.query(api.transactions.listStatisticsTransactions, { ...args, paginationOpts: { cursor: first.continueCursor, numItems: 30 } });
    expect(next.page.map(transaction => transaction.amountMinor)).toEqual([150]);
  });
  it("validates query ranges before reading financial records", async () => {
    const d = await setup();
    await expect(d.owner.query(api.transactions.getWalletStatistics, { ...d.args, start: "2026-02-30" })).rejects.toThrow("fechas válidas");
    await expect(d.owner.query(api.transactions.getWalletStatistics, { ...d.args, end: "2026-08-31" })).rejects.toThrow("anterior");
    await expect(d.owner.query(api.transactions.listStatisticsTransactions, { walletId: d.walletId, start: "2026-09-07", end: "2026-09-01", paginationOpts: { cursor: null, numItems: 30 } })).rejects.toThrow("anterior");
  });
});
