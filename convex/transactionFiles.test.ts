import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function registeredUser(t: TestConvex<typeof schema>, externalId: string) {
  const asUser = t.withIdentity({
    subject: externalId,
    tokenIdentifier: `https://clerk.test|${externalId}`,
  });
  await asUser.mutation(api.users.ensureCurrent, {});
  const viewer = await asUser.query(api.users.current, {});
  if (!viewer) throw new Error("Expected a registered viewer");
  return { asUser, viewer };
}

async function promoteToSuperadmin(t: TestConvex<typeof schema>, externalId: string) {
  await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    if (!user) throw new Error("Expected a user to promote");
    await ctx.db.patch(user._id, { platformRole: "superadmin" });
  });
}

describe("transaction files", () => {
  it("queues attached objects for deletion when their wallet is deleted", async () => {
    const t = convexTest(schema, modules);
    const { asUser, viewer } = await registeredUser(t, "wallet_files_owner");
    await promoteToSuperadmin(t, "wallet_files_owner");
    await asUser.mutation(api.superadmin.setFeatureOverride, {
      accountId: viewer.account._id,
      featureKey: "transactions.files",
      enabled: true,
    });
    const walletId = await asUser.mutation(api.wallets.createWallet, { name: "Comprobantes", currency: "CRC" });
    const batch = await asUser.mutation(api.transactionFiles.beginUpload, {
      walletId,
      retainedFileIds: [],
      files: [{ originalName: "nota.txt", mimeType: "text/plain", sizeBytes: 24, order: 0 }],
    });
    const transactionId = await asUser.mutation(internal.transactionFiles.commitUploadBatch, {
      batchId: batch.batchId,
      retainedFiles: [],
      verifiedFiles: [{ fileId: batch.fileIds[0], sizeBytes: 24 }],
      type: "expense", amountMinor: 100, description: "Prueba", date: "2026-09-05",
    });
    await asUser.mutation(api.wallets.archiveWallet, { walletId });
    await asUser.mutation(api.wallets.deleteWallet, { walletId });
    const deleted = await t.run(async (ctx) => ({
      wallet: await ctx.db.get(walletId),
      transaction: await ctx.db.get(transactionId),
      file: await ctx.db.get(batch.fileIds[0]),
      jobs: await ctx.db.query("r2DeletionJobs").collect(),
    }));
    expect(deleted.wallet).toBeNull();
    expect(deleted.transaction).toBeNull();
    expect(deleted.file).toBeNull();
    expect(deleted.jobs).toHaveLength(1);
  });

  it("is denied by default and can be enabled by a superadmin", async () => {
    const t = convexTest(schema, modules);
    const { asUser: asAdmin } = await registeredUser(t, "files_admin");
    await promoteToSuperadmin(t, "files_admin");
    const { asUser: asMember, viewer } = await registeredUser(t, "files_member");
    const walletId = await asMember.mutation(api.wallets.createWallet, {
      name: "Facturas",
      currency: "CRC",
    });
    const input = {
      walletId,
      retainedFileIds: [],
      files: [{
        originalName: "factura.pdf",
        displayName: "Factura de materiales",
        mimeType: "application/pdf" as const,
        sizeBytes: 512,
        order: 0,
      }],
    };

    await expect(asMember.mutation(api.transactionFiles.beginUpload, input)).rejects.toThrow(
      "Esta función no está habilitada",
    );
    await asAdmin.mutation(api.superadmin.setFeatureOverride, {
      accountId: viewer.account._id,
      featureKey: "transactions.files",
      enabled: true,
    });
    const batch = await asMember.mutation(api.transactionFiles.beginUpload, input);
    const stored = await t.run(async (ctx) => ({
      batch: await ctx.db.get(batch.batchId),
      file: await ctx.db.get(batch.fileIds[0]),
    }));
    expect(stored.batch).toMatchObject({ status: "pending", accountId: viewer.account._id });
    expect(stored.file).toMatchObject({
      originalName: "factura.pdf",
      displayName: "Factura de materiales",
      mimeType: "application/pdf",
      status: "pending",
    });
    expect(stored.file?.objectKey).toContain(`accounts/${viewer.account._id}/transaction-files/`);
  });

  it("hides preserved files when disabled and still cleans them on movement deletion", async () => {
    const t = convexTest(schema, modules);
    const { asUser: asAdmin } = await registeredUser(t, "files_admin");
    await promoteToSuperadmin(t, "files_admin");
    const { asUser: asMember, viewer } = await registeredUser(t, "files_owner");
    const walletId = await asMember.mutation(api.wallets.createWallet, {
      name: "Proyecto",
      currency: "USD",
    });
    const transactionId = await asMember.mutation(api.transactions.createTransaction, {
      walletId,
      type: "expense",
      amountMinor: 2500,
      description: "Compra",
      date: "2026-08-30",
    });
    await asAdmin.mutation(api.superadmin.setFeatureOverride, {
      accountId: viewer.account._id,
      featureKey: "transactions.files",
      enabled: true,
    });
    const fileId = await t.run(async (ctx) => {
      const now = Date.now();
      const batchId = await ctx.db.insert("fileUploadBatches", {
        accountId: viewer.account._id,
        walletId,
        targetTransactionId: transactionId,
        committedTransactionId: transactionId,
        createdByUserId: viewer.user._id,
        status: "committed",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      });
      const id = await ctx.db.insert("transactionFiles", {
        accountId: viewer.account._id,
        walletId,
        transactionId,
        uploadBatchId: batchId,
        createdByUserId: viewer.user._id,
        objectKey: `accounts/${viewer.account._id}/transaction-files/test-file`,
        originalName: "nota.txt",
        mimeType: "text/plain",
        sizeBytes: 24,
        order: 0,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(transactionId, { fileCount: 1 });
      return id;
    });

    const visible = await asMember.query(api.transactions.getTransaction, { transactionId });
    expect(visible.fileCount).toBe(1);
    if (!("files" in visible)) throw new Error("Expected visible file metadata");
    expect(visible.files).toHaveLength(1);

    await asAdmin.mutation(api.superadmin.setFeatureOverride, {
      accountId: viewer.account._id,
      featureKey: "transactions.files",
      enabled: false,
    });
    const hidden = await asMember.query(api.transactions.getTransaction, { transactionId });
    expect(hidden).not.toHaveProperty("fileCount");
    expect(hidden).not.toHaveProperty("files");
    await expect(
      asMember.query(api.transactionFiles.listByTransaction, { transactionId }),
    ).rejects.toThrow("Esta función no está habilitada");
    expect(await t.run(async (ctx) => ctx.db.get(fileId))).not.toBeNull();

    await asMember.mutation(api.transactions.deleteTransaction, { transactionId });
    const cleanup = await t.run(async (ctx) => ({
      transaction: await ctx.db.get(transactionId),
      file: await ctx.db.get(fileId),
      jobs: await ctx.db.query("r2DeletionJobs").collect(),
    }));
    expect(cleanup.transaction).toBeNull();
    expect(cleanup.file).toBeNull();
    expect(cleanup.jobs).toHaveLength(1);
    expect(cleanup.jobs[0]).toMatchObject({ reason: "transaction_deleted" });
  });

  it("commits the movement only after every pending file is verified", async () => {
    const t = convexTest(schema, modules);
    const { asUser: asAdmin } = await registeredUser(t, "atomic_admin");
    await promoteToSuperadmin(t, "atomic_admin");
    const { asUser: asMember, viewer } = await registeredUser(t, "atomic_owner");
    const walletId = await asMember.mutation(api.wallets.createWallet, {
      name: "Mudanza",
      currency: "CRC",
    });
    await asAdmin.mutation(api.superadmin.setFeatureOverride, {
      accountId: viewer.account._id,
      featureKey: "transactions.files",
      enabled: true,
    });
    const batch = await asMember.mutation(api.transactionFiles.beginUpload, {
      walletId,
      retainedFileIds: [],
      files: [
        {
          originalName: "factura.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
          order: 0,
        },
        {
          originalName: "detalle.txt",
          mimeType: "text/plain",
          sizeBytes: 24,
          order: 1,
        },
      ],
    });
    const transaction = {
      type: "expense" as const,
      amountMinor: 15_000,
      description: "Materiales",
      date: "2026-08-30",
    };

    await expect(asMember.mutation(internal.transactionFiles.commitUploadBatch, {
      batchId: batch.batchId,
      retainedFiles: [],
      verifiedFiles: [{ fileId: batch.fileIds[0], sizeBytes: 512 }],
      ...transaction,
    })).rejects.toThrow("No se pudieron verificar todos los archivos");
    expect(await t.run(async (ctx) => ctx.db.query("transactions").collect())).toHaveLength(0);

    const transactionId = await asMember.mutation(
      internal.transactionFiles.commitUploadBatch,
      {
        batchId: batch.batchId,
        retainedFiles: [],
        verifiedFiles: [
          { fileId: batch.fileIds[0], sizeBytes: 512, etag: "pdf-etag" },
          { fileId: batch.fileIds[1], sizeBytes: 24, etag: "txt-etag" },
        ],
        ...transaction,
      },
    );
    const stored = await asMember.query(api.transactions.getTransaction, { transactionId });
    expect(stored).toMatchObject({ description: "Materiales", fileCount: 2 });
    if (!("files" in stored)) throw new Error("Expected committed file metadata");
    expect(stored.files.map(({ originalName }) => originalName)).toEqual([
      "factura.pdf",
      "detalle.txt",
    ]);
  });
});
