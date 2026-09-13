import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { calculateWalletTotals, moneyInputValue, parseMoneyInput } from "../lib/money";

const fields = { type: "expense" as const, amountMinor: 4518150, moneyVersion: 2 as const, description: "Factura", date: "2026-09-12" };
const values = { type: "expense" as const, amount: "45181.50", description: "Factura", date: fields.date, notes: "", tagIds: [] };

async function setup(currency: "CRC" | "USD" = "CRC") {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "money-owner" });
  await owner.mutation(api.users.ensureCurrent, {});
  const viewer = (await owner.query(api.users.current, {}))!;
  await t.run(ctx => ctx.db.patch(viewer.user._id, { platformRole: "superadmin" }));
  for (const featureKey of ["transactions.files", "transactions.aiExtract"]) {
    await owner.mutation(api.superadmin.setFeatureOverride, { accountId: viewer.account._id, featureKey, enabled: true });
  }
  const walletId = await owner.mutation(api.wallets.createWallet, { name: "Histórico", currency });
  // Insert exactly the original schema, bypassing today's versioned write API.
  const legacyId = await t.run(ctx => ctx.db.insert("transactions", {
    ownerId: "money-owner", walletId, type: "income", amountMinor: 50000,
    description: "Ingreso histórico", date: fields.date, createdAt: 1, updatedAt: 1,
  }));
  return { t, owner, viewer, walletId, legacyId };
}

describe("money format compatibility", () => {
  it("preserves historical CRC storage and reconciles mixed-format summaries everywhere", async () => {
    const d = await setup();
    const original = await d.t.run(ctx => ctx.db.get(d.legacyId));
    const id = await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...fields });
    const transactions = await d.owner.query(api.transactions.listTransactionsByWallet, { walletId: d.walletId, moneyVersion: 2 });
    expect(transactions.find(t => t._id === d.legacyId)).toMatchObject({ amountMinor: 5000000, moneyVersion: 2 });
    expect(transactions.find(t => t._id === id)).toMatchObject({ amountMinor: 4518150, moneyVersion: 2 });
    const totals = { totalIncome: 5000000, totalExpense: 4518150, balance: 481850 };
    expect(calculateWalletTotals(transactions)).toEqual(totals);
    expect(await d.owner.query(api.wallets.getWallet, { walletId: d.walletId, moneyVersion: 2 })).toMatchObject(totals);
    expect(await d.owner.query(api.wallets.listActiveWallets, { moneyVersion: 2 })).toMatchObject([totals]);
    expect((await d.owner.query(api.superadmin.getAccount, { accountId: d.viewer.account._id, moneyVersion: 2 })).wallets).toMatchObject([totals]);
    await d.owner.mutation(api.wallets.archiveWallet, { walletId: d.walletId });
    expect(await d.owner.query(api.wallets.listArchivedWallets, { moneyVersion: 2 })).toMatchObject([totals]);
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toEqual(original);
    expect(await d.t.run(ctx => ctx.db.get(id))).toMatchObject({ amountMinor: 4518150, moneyVersion: 2 });
  });

  it.each(["CRC", "USD"] as const)("edits an old %s record twice without rescaling it twice", async currency => {
    const d = await setup(currency);
    const expected = currency === "CRC" ? 5000000 : 50000;
    for (let attempt = 0; attempt < 2; attempt++) {
      const transaction = await d.owner.query(api.transactions.getTransaction, { transactionId: d.legacyId, moneyVersion: 2 });
      expect(transaction.amountMinor).toBe(expected);
      const input = moneyInputValue(transaction.amountMinor, currency);
      await d.owner.mutation(api.transactions.updateTransaction, {
        transactionId: d.legacyId, ...fields, type: "income", amountMinor: parseMoneyInput(input, currency)!, description: `Edit ${attempt}`,
      });
      expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toMatchObject({ amountMinor: expected, moneyVersion: 2 });
    }
    expect((await d.owner.query(api.wallets.getWallet, { walletId: d.walletId, moneyVersion: 2 })).balance).toBe(expected);
  });

  it("keeps legacy and new USD cents in the same units", async () => {
    const d = await setup("USD");
    await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...fields, amountMinor: 1250 });
    expect(await d.owner.query(api.wallets.getWallet, { walletId: d.walletId, moneyVersion: 2 })).toMatchObject({ totalIncome: 50000, totalExpense: 1250, balance: 48750 });
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toMatchObject({ amountMinor: 50000 });
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).not.toHaveProperty("moneyVersion");
  });

  it("rejects every old monetary read API instead of returning cents to a whole-colón client", async () => {
    const d = await setup();
    const reads = [
      d.owner.query(api.transactions.getTransaction, { transactionId: d.legacyId }),
      d.owner.query(api.transactions.listTransactionsByWallet, { walletId: d.walletId }),
      d.owner.query(api.wallets.getWallet, { walletId: d.walletId }),
      d.owner.query(api.wallets.listActiveWallets, {}),
      d.owner.query(api.wallets.listArchivedWallets, {}),
      d.owner.query(api.superadmin.getAccount, { accountId: d.viewer.account._id }),
    ];
    for (const result of await Promise.allSettled(reads)) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(String(result.reason)).toContain("Actualizá la página");
    }
  });

  it("rejects old manual, draft, attachment, and upload saves without changing data or files", async () => {
    const d = await setup();
    const original = await d.t.run(ctx => ctx.db.get(d.legacyId));
    const oldFields = { type: fields.type, amountMinor: 50000, description: "Old tab", date: fields.date };
    const draftId = await d.owner.mutation(api.transactionDrafts.create, {
      walletId: d.walletId, transactionId: d.legacyId, expectedRevision: 0, expectedFileRevision: 0,
      clientKey: "old-draft", mode: "manual", values: { ...values, amount: "50000" },
    });
    const batch = await d.owner.mutation(api.transactionFiles.beginUpload, {
      walletId: d.walletId, transactionId: d.legacyId, expectedFileRevision: 0, retainedFileIds: [],
      files: [{ originalName: "receipt.txt", mimeType: "text/plain", sizeBytes: 5, order: 0 }],
    });
    await expect(d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...oldFields })).rejects.toThrow("Actualizá la página");
    await expect(d.owner.mutation(api.transactions.updateTransaction, { transactionId: d.legacyId, ...oldFields })).rejects.toThrow("Actualizá la página");
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId, version: 0, ...oldFields })).rejects.toThrow("Actualizá la página");
    await expect(d.owner.mutation(api.transactionFiles.updateTransactionWithFiles, { transactionId: d.legacyId, expectedFileRevision: 0, files: [], ...oldFields })).rejects.toThrow("Actualizá la página");
    await expect(d.owner.mutation(internal.transactionFiles.commitUploadBatch, {
      batchId: batch.batchId, retainedFiles: [], verifiedFiles: [{ fileId: batch.fileIds[0], sizeBytes: 5 }], ...oldFields,
    })).rejects.toThrow("Actualizá la página");
    await expect(d.owner.action(api.r2.finalizeUpload, { batchId: batch.batchId, retainedFiles: [], ...oldFields })).rejects.toThrow("Actualizá la página");
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toEqual(original);
    expect(await d.t.run(ctx => ctx.db.query("transactions").collect())).toHaveLength(1);
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toMatchObject({ status: "pending" });
    expect(await d.t.run(ctx => ctx.db.get(batch.batchId))).toMatchObject({ status: "pending" });
    expect(await d.t.run(ctx => ctx.db.get(draftId))).toMatchObject({ status: "active", values: { amount: "50000" } });
    expect(await d.t.run(ctx => ctx.db.query("r2DeletionJobs").collect())).toEqual([]);
  });

  it("rolls back attachment removals when an old client omits the money version", async () => {
    const d = await setup();
    const batch = await d.owner.mutation(api.transactionFiles.beginUpload, {
      walletId: d.walletId, transactionId: d.legacyId, expectedFileRevision: 0, retainedFileIds: [],
      files: [{ originalName: "receipt.txt", mimeType: "text/plain", sizeBytes: 5, order: 0 }],
    });
    await d.owner.mutation(internal.transactionFiles.commitUploadBatch, {
      batchId: batch.batchId, retainedFiles: [], verifiedFiles: [{ fileId: batch.fileIds[0], sizeBytes: 5 }],
      ...fields, type: "income", amountMinor: 5000000,
    });
    // Simulate an original-format record with a ready attachment.
    await d.t.run(ctx => ctx.db.patch(d.legacyId, { amountMinor: 50000, moneyVersion: undefined }));
    const original = await d.t.run(ctx => ctx.db.get(d.legacyId));
    await expect(d.owner.mutation(api.transactionFiles.updateTransactionWithFiles, {
      transactionId: d.legacyId, expectedFileRevision: 1, files: [],
      type: "income", amountMinor: 50000, description: "Old form", date: fields.date,
    })).rejects.toThrow("Actualizá la página");
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toEqual(original);
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toMatchObject({ status: "ready", transactionId: d.legacyId });
    expect(await d.t.run(ctx => ctx.db.query("r2DeletionJobs").collect())).toEqual([]);
  });

  it("resumes a legacy draft's major-unit string and saves it once in hundredths", async () => {
    const d = await setup();
    const draftId = await d.owner.mutation(api.transactionDrafts.create, {
      walletId: d.walletId, transactionId: d.legacyId, expectedRevision: 0, expectedFileRevision: 0,
      clientKey: "legacy-draft", mode: "manual", values: { ...values, type: "income", amount: "50000" },
    });
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId }))!;
    expect(draft.values.amount).toBe("50000");
    const args = { draftId, version: draft.version, ...fields, type: "income" as const, amountMinor: parseMoneyInput(draft.values.amount, "CRC")! };
    expect(await d.owner.mutation(api.transactionDrafts.save, args)).toBe(d.legacyId);
    expect(await d.owner.mutation(api.transactionDrafts.save, args)).toBe(d.legacyId);
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toMatchObject({ amountMinor: 5000000, moneyVersion: 2 });
  });

  it("preserves old attachment edits and fractional upload commits, including retries", async () => {
    const d = await setup();
    await d.owner.mutation(api.transactionFiles.updateTransactionWithFiles, {
      transactionId: d.legacyId, expectedFileRevision: 0, files: [], ...fields, type: "income", amountMinor: 5000000,
    });
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toMatchObject({ amountMinor: 5000000, moneyVersion: 2 });
    const batch = await d.owner.mutation(api.transactionFiles.beginUpload, {
      walletId: d.walletId, retainedFileIds: [], files: [{ originalName: "receipt.txt", mimeType: "text/plain", sizeBytes: 5, order: 0 }],
    });
    const args = { batchId: batch.batchId, retainedFiles: [], verifiedFiles: [{ fileId: batch.fileIds[0], sizeBytes: 5 }], ...fields };
    const id = await d.owner.mutation(internal.transactionFiles.commitUploadBatch, args);
    expect(await d.owner.mutation(internal.transactionFiles.commitUploadBatch, args)).toBe(id);
    expect(await d.t.run(ctx => ctx.db.get(id))).toMatchObject({ amountMinor: 4518150, moneyVersion: 2 });
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toMatchObject({ transactionId: id, status: "ready" });
  });

  it("locks the currency of existing wallets and pending drafts/uploads, but allows an empty wallet change", async () => {
    const d = await setup();
    await expect(d.owner.mutation(api.wallets.updateWallet, { walletId: d.walletId, name: "Histórico", currency: "USD" })).rejects.toThrow("No podés cambiar la moneda");
    await d.owner.mutation(api.wallets.updateWallet, { walletId: d.walletId, name: "Renamed", currency: "CRC" });
    for (const kind of ["empty", "draft", "upload"]) {
      const walletId = await d.owner.mutation(api.wallets.createWallet, { name: kind, currency: "CRC" });
      if (kind === "draft") await d.owner.mutation(api.transactionDrafts.create, { walletId, clientKey: "currency-draft", mode: "manual", values });
      if (kind === "upload") await d.owner.mutation(api.transactionFiles.beginUpload, { walletId, retainedFileIds: [], files: [{ originalName: "receipt.txt", mimeType: "text/plain", sizeBytes: 5, order: 0 }] });
      const change = d.owner.mutation(api.wallets.updateWallet, { walletId, name: kind, currency: "USD" });
      if (kind === "empty") await expect(change).resolves.toBeNull();
      else await expect(change).rejects.toThrow("No podés cambiar la moneda");
    }
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toMatchObject({ amountMinor: 50000 });
  });

  it("audits pages without modifying history and reports values that cannot be represented exactly", async () => {
    const d = await setup();
    const original = await d.t.run(ctx => ctx.db.get(d.legacyId));
    await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...fields });
    const first = await d.t.query(internal.transactions.auditMoneyCompatibility, { paginationOpts: { cursor: null, numItems: 1 } });
    expect(first).toMatchObject({ scanned: 1, legacyCRC: 1, versioned: 0, issues: [], isDone: false });
    const second = await d.t.query(internal.transactions.auditMoneyCompatibility, { paginationOpts: { cursor: first.continueCursor, numItems: 1 } });
    expect(second).toMatchObject({ scanned: 1, legacyCRC: 0, versioned: 1, issues: [], isDone: true });
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toEqual(original);
    await d.t.run(ctx => ctx.db.patch(d.legacyId, { amountMinor: Number.MAX_SAFE_INTEGER }));
    const audit = await d.t.query(internal.transactions.auditMoneyCompatibility, { paginationOpts: { cursor: null, numItems: 100 } });
    expect(audit.issues).toMatchObject([{ transactionId: d.legacyId }]);
    await expect(d.owner.query(api.transactions.getTransaction, { transactionId: d.legacyId, moneyVersion: 2 })).rejects.toThrow("precisión");
    expect(await d.t.run(ctx => ctx.db.get(d.legacyId))).toMatchObject({ amountMinor: Number.MAX_SAFE_INTEGER });
  });
});
