import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { FunctionArgs } from "convex/server";
import { modules } from "./test.setup";
import { parseMoneyInput } from "../lib/money";

const values = { type: "expense" as const, amount: "18500", description: "Materiales", date: "2026-09-12", notes: "", tagIds: [] };
const payload = { type: values.type, amountMinor: 1850000, description: values.description, date: values.date };
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
// Simulate records written by the previous application. New edit drafts are
// rejected by the public create mutation, while these can still be recovered.
async function legacyEditDraft(d: Awaited<ReturnType<typeof setup>>, args: FunctionArgs<typeof api.transactionDrafts.create>) {
  const draftId = await d.owner.mutation(api.transactionDrafts.create, { walletId: args.walletId, clientKey: args.clientKey, values: args.values, mode: args.mode });
  await d.t.run(async ctx => {
    const transaction = await ctx.db.get(args.transactionId!);
    const files = await ctx.db.query("transactionFiles").withIndex("by_transaction", q => q.eq("transactionId", args.transactionId!)).collect();
    await ctx.db.patch(draftId, { transactionId: args.transactionId, baseRevision: transaction?.revision ?? 0, baseFileRevision: transaction?.fileRevision ?? 0, fileIds: files.map(file => file._id) });
  });
  return draftId;
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
  it("allows manual drafts without file or AI access and keeps the previous mode preference", async () => {
    const d = await setup();
    await d.owner.mutation(api.transactionDrafts.setPreferredMode, { mode: "documents" });
    expect((await d.owner.query(api.users.current, {}))!.user.newTransactionMode).toBe("documents");
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.files", enabled: false });
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.aiExtract", enabled: false });
    const draftId = await d.owner.mutation(api.transactionDrafts.create, { walletId: d.walletId, clientKey: "other", values, mode: "manual" });
    const transactionId = await d.owner.mutation(api.transactionDrafts.save, { draftId, version: 0, ...payload });
    expect((await d.owner.query(api.transactions.getTransaction, { transactionId })).description).toBe(values.description);
    await expect(d.owner.mutation(api.transactionDrafts.beginFiles, { draftId: d.draftId, files: [{ originalName: "file.txt", mimeType: "text/plain", sizeBytes: 12 }] })).rejects.toThrow("no está habilitada");
  });
  it("keeps drafts for 24h without creating accounting records and commits once", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    expect(draft.expiresAt - draft.createdAt).toBe(86400000);
    expect(await d.owner.query(api.transactions.listTransactionsByWallet, { walletId: d.walletId })).toEqual([]);
    const args = { draftId: d.draftId, version: batch.version, ...payload };
    const first = await d.owner.mutation(api.transactionDrafts.save, args);
    expect(await d.owner.mutation(api.transactionDrafts.save, args)).toBe(first);
    const transaction = await d.owner.query(api.transactions.getTransaction, { transactionId: first });
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
    const draftId = await legacyEditDraft(d, { walletId: d.walletId, transactionId, expectedRevision: 0, expectedFileRevision: 0, clientKey: "edit", values, mode: "manual" });
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
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: batch.version, ...payload })).rejects.toThrow("confirmalo");
    const version = await d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: batch.version, values, mode: "documents", fileIds: batch.fileIds, selectedFileIds: batch.fileIds, reviewedFields: ["amount"] });
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version, ...payload })).resolves.toBeTruthy();
  });
  it.each([
    { amount: "18500.00", stored: 1850000 },
    { amount: "18500.50", stored: 1850050 },
    { amount: "0.01", stored: 1 },
  ])("extracts, detects duplicates, resumes and saves CRC $amount exactly", async ({ amount, stored }) => {
    const d = await setup(); const batch = await uploaded(d);
    const existingId = await d.t.run(ctx => ctx.db.insert("transactions", {
      ownerId: "receipt-owner", walletId: d.walletId, type: "expense", amountMinor: stored,
      description: "Existing", date: values.date, createdAt: 1, updatedAt: 1,
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
    expect(await d.owner.query(api.transactions.getTransaction, { transactionId: id })).toMatchObject({ amountMinor: minor, fileCount: 1 });
    expect(await d.t.run(ctx => ctx.db.get(id))).toMatchObject({ amountMinor: stored });
    expect(await d.t.run(ctx => ctx.db.get(existingId))).toEqual(before);
  });
  it("returns a currency warning and permits a manually entered local amount", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: result("USD"), pages: [1] });
    expect((await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!.extraction?.result).toMatchObject({ currencyMismatch: true, currency: "USD" });
    const version = await d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: batch.version, values: { ...values, amount: "6000" }, mode: "documents", fileIds: batch.fileIds, selectedFileIds: batch.fileIds, reviewedFields: ["amount"] });
    const id = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version, ...payload, amountMinor: 600000 });
    expect((await d.owner.query(api.transactions.getTransaction, { transactionId: id })).amountMinor).toBe(600000);
  });
  it("records irrelevant-document errors without creating a movement", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: batch.version });
    await d.t.mutation(internal.transactionExtractions.dispatch, { extractionId });
    await d.t.mutation(internal.transactionExtractions.finish, { extractionId, result: result("CRC", "unrelated"), pages: [1] });
    expect((await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!.extraction).toMatchObject({ status: "failed", errorCode: "unrelated" });
    expect((await d.owner.query(api.transactionExtractions.adminUsage, { accountId: d.viewer.account._id })).current).toMatchObject({ used: 1, errors: 1 });
    expect(await d.owner.query(api.transactions.listTransactionsByWallet, { walletId: d.walletId })).toEqual([]);
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

describe("step-by-step movements", () => {
  it("attaches and commits files without AI access or analysis usage", async () => {
    const d = await setup();
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.aiExtract", enabled: false });
    const batch = await uploaded(d);
    const version = await d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: batch.version, values, mode: "manual", fileIds: batch.fileIds, selectedFileIds: [], reviewedFields: [] });
    await expect(d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version })).rejects.toThrow("no está habilitada");
    const id = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version, ...payload });
    expect(await d.owner.query(api.transactions.getTransaction, { transactionId: id })).toMatchObject({ files: [expect.objectContaining({ originalName: "comprobante-0.txt" })] });
    expect(await d.owner.query(api.transactionExtractions.usage, {})).toMatchObject({ used: 0, reserved: 0 });
  });

  it("preserves the reviewed source and suggestions when only backing files change", async () => {
    const d = await setup(); const source = await uploaded(d);
    const extractionId = await d.owner.mutation(api.transactionExtractions.start, { draftId: d.draftId, version: source.version });
    await d.t.run(ctx => ctx.db.patch(extractionId, { status: "ready", result: { status: "ok", currency: "CRC", currencyMismatch: false, duplicate: false } }));
    const reviewedVersion = await d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: source.version, values, mode: "documents", fileIds: source.fileIds, selectedFileIds: source.fileIds, reviewedFields: ["amount"] });
    const extra = await d.owner.mutation(api.transactionDrafts.beginFiles, { draftId: d.draftId, files: [{ originalName: "respaldo.txt", mimeType: "text/plain", sizeBytes: 12 }] });
    await d.owner.mutation(internal.transactionDrafts.verifiedFiles, { draftId: d.draftId, batchId: extra.batchId, files: extra.fileIds.map(fileId => ({ fileId, etag: "verified" })) });
    const version = await d.owner.mutation(api.transactionDrafts.update, { draftId: d.draftId, version: reviewedVersion, values, mode: "documents", fileIds: [...source.fileIds, ...extra.fileIds], selectedFileIds: source.fileIds, reviewedFields: ["amount"] });
    const draft = (await d.owner.query(api.transactionDrafts.get, { draftId: d.draftId }))!;
    expect(draft.extraction?._id).toBe(extractionId);
    expect(draft.reviewedFields).toEqual(["amount"]);
    const id = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version, ...payload });
    const record = await d.owner.query(api.transactions.getTransaction, { transactionId: id });
    expect("files" in record ? record.files : undefined).toHaveLength(2);
    expect(record.receiptFileIds).toEqual(source.fileIds);
  });

  it("preserves existing files during field-only editing after attachment access is disabled", async () => {
    const d = await setup(); const batch = await uploaded(d);
    const transactionId = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: batch.version, ...payload });
    await d.owner.mutation(api.superadmin.setFeatureOverride, { accountId: d.viewer.account._id, featureKey: "transactions.files", enabled: false });
    const draftId = await legacyEditDraft(d, { walletId: d.walletId, transactionId, expectedRevision: 1, clientKey: "edit-without-files", values: { ...values, description: "Datos corregidos" }, mode: "manual" });
    await d.owner.mutation(api.transactionDrafts.save, { draftId, version: 0, ...payload, description: "Datos corregidos" });
    expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toMatchObject({ transactionId, status: "ready" });
  });

  it("rejects stale confirmation data and changed currency without affecting balance", async () => {
    const d = await setup();
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: 0, ...payload, amountMinor: 12 })).rejects.toThrow("desde la revisión");
    await d.t.run(ctx => ctx.db.patch(d.walletId, { currency: "USD" }));
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: 0, currency: "CRC", ...payload })).rejects.toThrow("moneda");
    expect(await d.owner.query(api.transactions.listTransactionsByWallet, { walletId: d.walletId })).toEqual([]);
  });

  it("blocks creation, updates and deletion while archived; detail remains readable", async () => {
    const d = await setup();
    const transactionId = await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...payload });
    await d.owner.mutation(api.wallets.archiveWallet, { walletId: d.walletId });
    await expect(d.owner.mutation(api.transactionDrafts.create, { walletId: d.walletId, clientKey: "archived", values, mode: "manual" })).rejects.toThrow();
    await expect(d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: 0, ...payload })).rejects.toThrow("Restaurá");
    await expect(d.owner.mutation(api.transactions.deleteTransaction, { transactionId })).rejects.toThrow("Restaurá");
    expect((await d.owner.query(api.transactions.getTransaction, { transactionId })).description).toBe(values.description);
  });

  it("rejects stale deletion and foreign draft access", async () => {
    const d = await setup();
    const transactionId = await d.owner.mutation(api.transactions.createTransaction, { walletId: d.walletId, ...payload });
    await d.owner.mutation(api.transactions.updateTransaction, { transactionId, ...payload, description: "Actualizado" });
    await expect(d.owner.mutation(api.transactions.deleteTransaction, { transactionId, expectedRevision: 0 })).rejects.toThrow("otra sesión");
    const stranger = d.t.withIdentity({ subject: "another-movement-owner" });
    await stranger.mutation(api.users.ensureCurrent, {});
    await expect(stranger.query(api.transactionDrafts.get, { draftId: d.draftId })).rejects.toThrow();
    await expect(stranger.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: 0, ...payload })).rejects.toThrow();
  });

  it("keeps original attachments until an edited draft is explicitly committed", async () => {
    const d = await setup(); const batch = await uploaded(d, 2);
    const transactionId = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: batch.version, ...payload });
    const draftId = await legacyEditDraft(d, { walletId: d.walletId, transactionId, expectedRevision: 1, expectedFileRevision: 1, clientKey: "remove-file", values, mode: "manual" });
    const version = await d.owner.mutation(api.transactionDrafts.update, { draftId, version: 0, values, mode: "manual", fileIds: [batch.fileIds[0]], selectedFileIds: [], reviewedFields: [] });
    expect(await d.owner.query(api.transactions.getTransaction, { transactionId })).toMatchObject({ fileCount: 2 });
    await d.owner.mutation(api.transactionDrafts.save, { draftId, version, ...payload });
    expect(await d.owner.query(api.transactions.getTransaction, { transactionId })).toMatchObject({ fileCount: 1 });
    expect((await d.owner.query(api.wallets.getWallet, { walletId: d.walletId }))?.balance).toBe(-1850000);
  });
});

it("keeps file renames in the draft until confirmation", async () => {
  const d = await setup(); const batch = await uploaded(d);
  const transactionId = await d.owner.mutation(api.transactionDrafts.save, { draftId: d.draftId, version: batch.version, ...payload });
  const draftId = await legacyEditDraft(d, { walletId: d.walletId, transactionId, expectedRevision: 1, expectedFileRevision: 1, clientKey: "rename-file", values, mode: "manual" });
  const version = await d.owner.mutation(api.transactionDrafts.update, { draftId, version: 0, values, mode: "manual", fileIds: batch.fileIds, selectedFileIds: [], reviewedFields: [], fileNames: [{ fileId: batch.fileIds[0], displayName: "Factura del taller" }] });
  expect((await d.owner.query(api.transactionDrafts.get, { draftId }))?.files[0].displayName).toBe("Factura del taller");
  expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).not.toHaveProperty("displayName");
  await d.owner.mutation(api.transactionDrafts.save, { draftId, version, ...payload });
  expect(await d.t.run(ctx => ctx.db.get(batch.fileIds[0]))).toHaveProperty("displayName", "Factura del taller");
});

it("retries a fresh creation after an expired draft with the same client key awaits cleanup", async () => {
  const d = await setup();
  await d.t.run(ctx => ctx.db.patch(d.draftId, { expiresAt: Date.now() - 1 }));
  vi.setSystemTime(Date.now() + 1);
  const args = { walletId: d.walletId, clientKey: "draft-1", values, mode: "manual" as const };
  const fresh = await d.owner.mutation(api.transactionDrafts.create, args);
  expect(fresh).not.toBe(d.draftId);
  expect(await d.owner.mutation(api.transactionDrafts.create, args)).toBe(fresh);
});
