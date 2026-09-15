import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { calculateWalletTotals, moneyInputValue, parseMoneyInput } from "../lib/money";

const fields = { type: "expense" as const, amountMinor: 4518150, description: "Factura", date: "2026-09-12" };
const values = { type: "income" as const, amount: "50000", description: "Ingreso", date: fields.date, notes: "", tagIds: [] };

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "migration-owner" });
  await owner.mutation(api.users.ensureCurrent, {});
  const viewer = (await owner.query(api.users.current, {}))!;
  await t.run(ctx => ctx.db.patch(viewer.user._id, { platformRole: "superadmin" }));
  for (const featureKey of ["transactions.files", "transactions.aiExtract"]) {
    await owner.mutation(api.superadmin.setFeatureOverride, { accountId: viewer.account._id, featureKey, enabled: true });
  }
  const crcWalletId = await owner.mutation(api.wallets.createWallet, { name: "CRC", currency: "CRC" });
  const usdWalletId = await owner.mutation(api.wallets.createWallet, { name: "USD", currency: "USD" });
  // Original whole-CRC records, alongside the unchanged USD-cent format.
  const ids = await t.run(async ctx => {
    const base = { ownerId: "migration-owner", description: "Original", date: fields.date, createdAt: 1, updatedAt: 1, revision: 3 };
    return Promise.all([
      ctx.db.insert("transactions", { ...base, walletId: crcWalletId, type: "income", amountMinor: 50000 }),
      ctx.db.insert("transactions", { ...base, walletId: crcWalletId, type: "expense", amountMinor: 45181 }),
      ctx.db.insert("transactions", { ...base, walletId: usdWalletId, type: "income", amountMinor: 1250 }),
    ]);
  });
  const snapshot = () => t.run(async ctx => {
    const transactions = await ctx.db.query("transactions").collect();
    const wallets = await ctx.db.query("wallets").collect();
    return { expectedTransactions: transactions.map(transaction => ({ transactionId: transaction._id, walletId: transaction.walletId, currency: wallets.find(w => w._id === transaction.walletId)!.currency, amountMinor: transaction.amountMinor, updatedAt: transaction.updatedAt })) };
  });
  return { t, owner, viewer, crcWalletId, usdWalletId, ids, snapshot };
}

describe("one-time CRC migration", () => {
  it("changes only CRC amounts, preserves USD and metadata, and reconciles all summaries", async () => {
    const d = await setup();
    const before = await d.t.run(ctx => ctx.db.query("transactions").collect());
    expect(await d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot())).toEqual({ alreadyApplied: false, transactionCount: 3, crcCount: 2, usdCount: 1 });
    const after = await d.t.run(ctx => ctx.db.query("transactions").collect());
    expect(after).toEqual(before.map(t => ({ ...t, amountMinor: t.amountMinor * (t.walletId === d.crcWalletId ? 100 : 1) })));
    const totals = { totalIncome: 5000000, totalExpense: 4518100, balance: 481900 };
    expect(await d.owner.query(api.wallets.getWallet, { walletId: d.crcWalletId })).toMatchObject(totals);
    expect(calculateWalletTotals(await d.owner.query(api.transactions.listTransactionsByWallet, { walletId: d.crcWalletId }))).toEqual(totals);
    expect(await d.owner.query(api.wallets.listActiveWallets, {})).toEqual(expect.arrayContaining([expect.objectContaining(totals)]));
    expect((await d.owner.query(api.superadmin.getAccount, { accountId: d.viewer.account._id })).wallets).toEqual(expect.arrayContaining([expect.objectContaining(totals)]));
    await d.owner.mutation(api.wallets.archiveWallet, { walletId: d.crcWalletId });
    expect(await d.owner.query(api.wallets.listArchivedWallets, {})).toMatchObject([totals]);
    expect((await d.owner.query(api.wallets.getWallet, { walletId: d.usdWalletId })).balance).toBe(1250);
  });

  it("records completion atomically and never multiplies again, even after later decimal writes", async () => {
    const d = await setup(); const args = await d.snapshot();
    await d.t.mutation(internal.migrations.migrateCrcToHundredths, args);
    await d.owner.mutation(api.transactions.createTransaction, { walletId: d.crcWalletId, ...fields });
    const beforeRetry = await d.t.run(ctx => ctx.db.query("transactions").collect());
    expect(await d.t.mutation(internal.migrations.migrateCrcToHundredths, args)).toMatchObject({ alreadyApplied: true, crcCount: 2 });
    expect(await d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot())).toMatchObject({ alreadyApplied: true });
    expect(await d.t.run(ctx => ctx.db.query("transactions").collect())).toEqual(beforeRetry);
    expect(await d.t.run(ctx => ctx.db.query("dataMigrations").collect())).toHaveLength(1);
  });

  it.each(["amount", "timestamp", "currency", "count", "duplicate", "missing-wallet"])("rejects a changed %s snapshot without patching any records", async kind => {
    const d = await setup(); const args = await d.snapshot();
    if (kind === "amount") await d.t.run(ctx => ctx.db.patch(d.ids[1], { amountMinor: 45182 }));
    if (kind === "timestamp") await d.t.run(ctx => ctx.db.patch(d.ids[1], { updatedAt: 2 }));
    if (kind === "currency") await d.t.run(ctx => ctx.db.patch(d.usdWalletId, { currency: "CRC" }));
    if (kind === "count") args.expectedTransactions.pop();
    if (kind === "duplicate") args.expectedTransactions[1] = args.expectedTransactions[0];
    if (kind === "missing-wallet") await d.t.run(ctx => ctx.db.delete(d.usdWalletId));
    const before = await d.t.run(ctx => ctx.db.query("transactions").collect());
    await expect(d.t.mutation(internal.migrations.migrateCrcToHundredths, args)).rejects.toThrow();
    expect(await d.t.run(ctx => ctx.db.query("transactions").collect())).toEqual(before);
    expect(await d.t.run(ctx => ctx.db.query("dataMigrations").collect())).toEqual([]);
  });

  it.each([0, -1, 45181.5, Number.MAX_SAFE_INTEGER])("rejects unsafe original amount %s atomically", async amountMinor => {
    const d = await setup();
    await d.t.run(ctx => ctx.db.patch(d.ids[1], { amountMinor }));
    const before = await d.t.run(ctx => ctx.db.query("transactions").collect());
    await expect(d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot())).rejects.toThrow("precisión");
    expect(await d.t.run(ctx => ctx.db.query("transactions").collect())).toEqual(before);
    expect(await d.t.run(ctx => ctx.db.query("dataMigrations").collect())).toEqual([]);
  });

  it("rejects an overflowing wallet total even when individual amounts fit", async () => {
    const d = await setup();
    await d.t.run(async ctx => {
      await ctx.db.patch(d.ids[0], { amountMinor: 90071992547409 });
      await ctx.db.patch(d.ids[1], { type: "income", amountMinor: 1 });
    });
    await expect(d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot())).rejects.toThrow("precisión");
    expect(await d.t.run(ctx => ctx.db.get(d.ids[0]))).toMatchObject({ amountMinor: 90071992547409 });
    expect(await d.t.run(ctx => ctx.db.query("dataMigrations").collect())).toEqual([]);
  });

  it("keeps draft strings unchanged and lets a resumed draft save the migrated amount", async () => {
    const d = await setup();
    // An edit draft persisted by the previous app; new edits no longer create drafts.
    const now = Date.now();
    const draftId = await d.t.run(ctx => ctx.db.insert("transactionDrafts", {
      accountId: d.viewer.account._id, userId: d.viewer.user._id, walletId: d.crcWalletId,
      transactionId: d.ids[0], baseRevision: 3, baseFileRevision: 0,
      clientKey: "before-migration", mode: "manual", values, version: 0,
      fileIds: [], selectedFileIds: [], reviewedFields: [], status: "active",
      createdAt: now, updatedAt: now, expiresAt: now + 86400000,
    }));
    const before = await d.t.run(ctx => ctx.db.get(draftId));
    await d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot());
    expect(await d.t.run(ctx => ctx.db.get(draftId))).toEqual(before);
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId }))!;
    const args = { draftId, version: draft.version, ...fields, type: draft.values.type, description: draft.values.description, amountMinor: parseMoneyInput(draft.values.amount, "CRC")! };
    await d.owner.mutation(api.transactionDrafts.save, args);
    await d.owner.mutation(api.transactionDrafts.save, args);
    expect(await d.t.run(ctx => ctx.db.get(d.ids[0]))).toMatchObject({ amountMinor: 5000000 });
  });

  it("edits migrated money repeatedly using the ordinary API and saves new decimal amounts", async () => {
    const d = await setup();
    await d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot());
    for (let n = 0; n < 2; n++) {
      const transaction = await d.owner.query(api.transactions.getTransaction, { transactionId: d.ids[1] });
      expect(moneyInputValue(transaction.amountMinor, "CRC")).toBe("45181.00");
      await d.owner.mutation(api.transactions.updateTransaction, { transactionId: d.ids[1], ...fields, amountMinor: parseMoneyInput(moneyInputValue(transaction.amountMinor, "CRC"), "CRC")! });
    }
    await d.owner.mutation(api.transactions.createTransaction, { walletId: d.crcWalletId, ...fields, amountMinor: 50 });
    expect((await d.owner.query(api.wallets.getWallet, { walletId: d.crcWalletId })).balance).toBe(481850);
  });

  it("continues preventing currency changes from reinterpreting stored amounts", async () => {
    const d = await setup();
    await d.t.mutation(internal.migrations.migrateCrcToHundredths, await d.snapshot());
    await expect(d.owner.mutation(api.wallets.updateWallet, { walletId: d.crcWalletId, name: "CRC", currency: "USD" })).rejects.toThrow("No podés cambiar la moneda");
    await d.owner.mutation(api.wallets.updateWallet, { walletId: d.crcWalletId, name: "Renamed", currency: "CRC" });
  });
});
