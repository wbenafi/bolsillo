import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { parseMoneyInput } from "../lib/money";

const values = { type: "expense" as const, amount: "18500", description: "Materiales", date: "2026-09-12", notes: "", tagIds: [] };
const payload = { type: values.type, moneyVersion: 2 as const, amountMinor: 1850000, description: values.description, date: values.date };
async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "receipt-owner" });
  await owner.mutation(api.users.ensureCurrent, {});
  const viewer = (await owner.query(api.users.current, {}))!;
  await t.run(ctx => ctx.db.patch(viewer.user._id, { platformRole: "superadmin" }));
  for (const featureKey of ["transactions.files", "transactions.aiExtract"]) await owner.mutation(api.superadmin.setFeatureOverride, { accountId: viewer.account._id, featureKey, enabled: true });
  const walletId = await owner.mutation(api.wallets.createWallet, { name: "Casa", currency: "CRC" });
  const draftId = await owner.mutation(api.transactionDrafts.create, { walletId, clientKey: "draft-1", values, mode: "documents" });
  return { t, owner, viewer, walletId, draftId };
}
async function uploaded(data: Awaited<ReturnType<typeof setup>>, count = 1) {
  const batch = await data.owner.mutation(api.transactionDrafts.beginFiles, { draftId: data.draftId, files: Array.from({ length: count }, (_, i) => ({ originalName: `comprobante-${i}.txt`, mimeType: "text/plain" as const, sizeBytes: 12 })) });
  await data.owner.mutation(internal.transactionDrafts.verifiedFiles, { draftId: data.draftId, batchId: batch.batchId, files: batch.fileIds.map(fileId => ({ fileId, etag: "server-verified" })) });
  const draft = (await data.owner.query(api.transactionDrafts.get, { draftId: data.draftId }))!;
  const version = await data.owner.mutation(api.transactionDrafts.update, { draftId: data.draftId, version: draft.version, values, mode: "documents", fileIds: batch.fileIds, selectedFileIds: batch.fileIds, reviewedFields: [] });
  return { ...batch, version };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("receipt drafts", () => {
  it("requires both feature flags and stores the user's last mode", async () => {
    const d = await setup();
    await d.owner.mutation(api.transactionDrafts.setPreferredMode, { mode: "documents" });
    expect((await d.owner.query(api.users.current, {}))!.user.newTransactionMode).toBe("documents");
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.files", enabled: false });
    await expect(d.owner.mutation(api.transactionDrafts.create, { walletId: d.walletId, clientKey: "other", values, mode: "manual" })).rejects.toThrow("no está habilitada");
  });
  it("keeps drafts for 24h without creating accounting records and commits once", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    expect(draft.expiresAt - draft.createdAt).toBe(86400000);
    expect(await d.owner.query(api.transactions.listTransactionsByWallet, { moneyVersion: 2, walletId: d.walletId })).toEqual([]);
    const args = { draftId: d.draftId, version: batch.version, ...payload };
    const first = await d.owner.mutation(api.transactionDrafts.save, args);
    expect(await d.owner.mutation(api.transactionDrafts.save, args)).toBe(first);
    const transaction = await d.owner.query(api.transactions.getTransaction, { moneyVersion: 2, transactionId: first });
    expect(transaction.fileCount).toBe(1);
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toMatchObject({ status: "ready", transactionId: first });
  });
  it("isolates draft reads, upload verification and file selections by account", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const stranger = d.t.withIdentity({ subject: "stranger" }); await stranger.mutation(api.users.ensureCurrent, {});
    await expect(stranger.query(api.transactionDrafts.get, { draftId: d.draftId })).rejects.toThrow();
    await expect(stranger.query(internal.transactionDrafts.fileForRead, { draftId: d.draftId, fileId: batch.fileIds[0] })).rejects.toThrow();
    const other = await d.owner.mutation(api.transactionDrafts.create, { walletId: d.walletId, clientKey: "other", values, mode: "documents" });
    await expect(d.owner.mutation(api.transactionDrafts.update, { draftId: other, version: 0, values, mode: "documents", fileIds: batch.fileIds, selectedFileIds: batch.fileIds, reviewedFields: [] })).rejects.toThrow();
    await expect(d.owner.mutation(internal.transactionFiles.commitUploadBatch, { batchId: batch.batchId, retainedFiles: [], verifiedFiles: batch.fileIds.map(fileId => ({ fileId, sizeBytes: 12 })), ...payload })).rejects.toThrow("borrador");
  });
  it("rejects unverified files, extra files and stale draft writes", async () => {
    const d = await setup(); const batch = await d.owner.mutation(api.transactionDrafts.beginFiles, { draftId: d.draftId, files: [{ originalName: "test.txt", mimeType: "text/plain", sizeBytes: 12 }] });
    await expect(d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: 0, values, mode: "documents", fileIds: batch.fileIds, selectedFileIds: batch.fileIds, reviewedFields: [] })).rejects.toThrow("terminen de subir");
    const done = await uploaded(d, 5);
    await expect(d.owner.mutation(api.transactionDrafts.beginFiles, { draftId: d.draftId, files: [{ originalName: "extra.txt", mimeType: "text/plain", sizeBytes: 12 }] })).rejects.toThrow("5 archivos");
    await expect(d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: done.version - 1, values, mode: "manual", fileIds: done.fileIds, selectedFileIds: done.fileIds, reviewedFields: [] })).rejects.toThrow("otra pestaña");
  });
  it("saves manually after AI is disabled, and deletes unused uploaded objects", async () => {
    const d = await setup(); const batch = await uploaded(d, 2);
    const version = await d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: batch.version, values, mode: "manual", fileIds: [batch.fileIds[0]], selectedFileIds: [], reviewedFields: ["amount"] });
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.aiExtract", enabled: false });
    await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version, ...payload });
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[1]))).toBeNull();
    expect((await d.t.run(ctx => ctx.db.query("r2DeletionJobs").collect())).length).toBe(1);
  });
  it("does not overwrite a movement edited in another session", async () => {
    const d = await setup(); const transactionId = await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...payload });
    const draftId = await d.owner.mutation(api.transactionDrafts.create, { walletId: d.walletId, transactionId, expectedRevision: 0, expectedFileRevision: 0, clientKey: "edit", values, mode: "manual" });
    await d.owner.mutation(api.transactions.updateTransaction, { transactionId, ...payload, description: "Nueva descripción" });
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId, version: 0, ...payload })).rejects.toThrow("otra sesión");
  });
  it("expires drafts and queues private object cleanup", async () => {
    const d = await setup(); const batch = await uploaded(d);
    vi.setSystemTime(Date.now() + 86400001);
    await d.t.mutation(internal.transactionDrafts.expire, { draftId: d.draftId });
    expect(await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId })).toBeNull();
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toBeNull();
    expect((await d.t.run(ctx => ctx.db.query("r2DeletionJobs").collect()))).toHaveLength(1);
  });
});
describe("AI analysis accounting", () => {
  it("reserves atomically, deduplicates double clicks, and refunds before dispatch", async () => {
    const d = await setup(); const batch = await uploaded(d);
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.aiExtract", enabled: true, limit: 1 });
    const [a, b] = await Promise.all([d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version }), d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version })]);
    expect(a).toBe(b); expect(await d.owner.query(api.transactionExtractions.usage, {})).toMatchObject({ used: 0, reserved: 1 });
    await d.owner.mutation(api.transactionExtractions.cancel, { draftId: d.draftId });
    expect(await d.owner.query(api.transactionExtractions.usage, {})).toMatchObject({ used: 0, reserved: 0 });
  });
  it("charges dispatched requests and ignores late results after cancellation", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    expect(await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId })).toBe(true);
    await d.owner.mutation(api.transactionExtractions.cancel, { draftId: d.draftId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, inputTokens: 200, outputTokens: 100, costUsd: .001 });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, inputTokens: 200, outputTokens: 100, costUsd: .001 });
    expect((await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!.extraction).toMatchObject({ status: "cancelled" });
    const admin = await d.owner.query(api.transactionExtractions.adminUsage, { accountId: d.viewer.account._id });
    expect(admin.current).toMatchObject({ used: 1, reserved: 0, inputTokens: 200, costUsd: .001 });
  });
  it("rejects a new analysis over quota and starts a fresh calendar month", async () => {
    const d = await setup(); const batch = await uploaded(d);
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.aiExtract", enabled: true, limit: 1 });
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, errorCode: "timeout" });
    await expect(d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version })).rejects.toThrow("límite");
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(await d.owner.query(api.transactionExtractions.usage, {})).toMatchObject({ used: 0, month: "2027-01" });
  });
  it("rechecks feature access at dispatch and delivery", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.aiExtract", enabled: false });
    expect(await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId })).toBe(false);
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, errorCode: "disabled" });
    expect((await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!.extraction?.status).toBe("cancelled");
    expect(await d.owner.query(api.transactionExtractions.usage, {})).toMatchObject({ reserved: 0, used: 0 });
  });
});

describe("AI results and warnings", () => {
  function result(currency = "CRC", status = "ok") {
    const field = (value: unknown) => ({ value, confidence: value === null ? "unknown" : "high", reason: "Visible", evidence: value === null ? null : { file: 1, page: 1, quote: "Comprobante" } });
    return { status, currency, fields: { type: field("expense"), amount: field(currency === "CRC" ? "18500" : "12.50"), description: field("Materiales"), date: field("2026-09-12"), notes: field(null), tags: field(null) } };
  }
  it("warns about a possible duplicate without blocking a manual save", async () => {
    const d = await setup(); const batch = await uploaded(d);
    await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...payload });
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: result(), pages: [1], inputTokens: 100, outputTokens: 50 });
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    expect(draft.extraction?.result).toMatchObject({ duplicate: true, currencyMismatch: false });
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: batch.version, ...payload })).resolves.toBeTruthy();
  });
  it.each([
    { amount: "18500.00", stored: 18500, legacy: true },
    { amount: "18500.50", stored: 1850050, legacy: false },
    { amount: "0.01", stored: 1, legacy: false },
  ])("extracts, detects duplicates, resumes and saves CRC $amount exactly", async ({ amount, stored, legacy }) => {
    const d = await setup(); const batch = await uploaded(d);
    const existingId = await d.t.run(ctx => ctx.db.insert("transactions", {
      ownerId: "receipt-owner", walletId: d.walletId, type: "expense", amountMinor: stored,
      ...(legacy ? {} : { moneyVersion: 2 as const }), description: "Existing", date: values.date, createdAt: 1, updatedAt: 1,
    }));
    const before = await d.t.run(ctx => ctx.db.get(existingId));
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    const extracted = result(); extracted.fields.amount.value = amount;
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: extracted, pages: [1] });
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    expect(draft.extraction?.result).toMatchObject({ status: "ok", duplicate: true, fields: { amount: { value: amount, confidence: "high" } } });
    const version = await d.owner.mutation(api.transactionDrafts.update, {
      draftId: d.draftId, version: draft.version, values: { ...values, amount }, mode: "documents",
      fileIds: batch.fileIds, selectedFileIds: batch.fileIds, reviewedFields: ["amount"],
    });
    const resumed = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    const minor = parseMoneyInput(resumed.values.amount, "CRC")!;
    const id = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version, ...payload, amountMinor: minor });
    expect(await d.owner.query(api.transactions.getTransaction, { transactionId: id, moneyVersion: 2 })).toMatchObject({ amountMinor: minor, fileCount: 1 });
    expect(await d.t.run(ctx => ctx.db.get(id))).toMatchObject({ amountMinor: legacy ? stored * 100 : stored, moneyVersion: 2 });
    expect(await d.t.run(ctx => ctx.db.get(existingId))).toEqual(before);
  });
  it("returns a currency warning and permits a manually entered local amount", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: result("USD"), pages: [1] });
    expect((await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!.extraction?.result).toMatchObject({ currencyMismatch: true, currency: "USD" });
    const id = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: batch.version, ...payload, moneyVersion: 2 as const, amountMinor: 6000 });
    expect((await d.owner.query(api.transactions.getTransaction, { moneyVersion: 2, transactionId: id })).amountMinor).toBe(6000);
  });
  it("records irrelevant-document errors without creating a movement", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: result("CRC", "unrelated"), pages: [1] });
    expect((await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!.extraction).toMatchObject({ status: "failed", errorCode: "unrelated" });
    expect((await d.owner.query(api.transactionExtractions.adminUsage, { accountId: d.viewer.account._id })).current).toMatchObject({ used: 1, errors: 1 });
    expect(await d.owner.query(api.transactions.listTransactionsByWallet, { moneyVersion: 2, walletId: d.walletId })).toEqual([]);
  });
  it("records late usage after a timeout without delivering late results", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.timeout, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: result(), pages: [1], inputTokens: 200, outputTokens: 100 });
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    expect(draft.extraction?.status).toBe("failed"); expect(draft.extraction?.result).toBeUndefined();
    expect((await d.owner.query(api.transactionExtractions.adminUsage, { accountId: d.viewer.account._id })).current).toMatchObject({ used: 1, errors: 1, inputTokens: 200 });
  });
});

it("makes an explicit reread billable while deduplicating a retried request", async () => {
  const d = await setup(); const batch = await uploaded(d);
  const first = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version, requestKey: "first" });
  await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId: first });
  const field = { value: null, confidence: "unknown", reason: "No visible", evidence: null };
  await d.t.mutation(internal.transactionExtractions.finish, { extractionId: first, result: { status: "partial", currency: null, fields: { type: field, amount: field, description: field, date: field, notes: field, tags: field } }, pages: [1] });
  expect(await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version })).toBe(first);
  const second = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version, reanalyze: true, requestKey: "second" });
  expect(second).not.toBe(first);
  expect(await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version, reanalyze: true, requestKey: "second" })).toBe(second);
  await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId: second });
  expect(await d.owner.query(api.transactionExtractions.usage, {})).toMatchObject({ used: 2, reserved: 0 });
});
