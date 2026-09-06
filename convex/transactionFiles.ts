import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAccountContext, requireFeature } from "./auth";
import { optionalText, requireOwnedWallet, requireText } from "./domain";
import { transactionFileTypeValidator } from "./schema";
import { validateAssignedTagIds } from "./tags";
import { transactionFields, validatedTransactionFields } from "./transactionDomain";
import {
  MAX_TRANSACTION_FILE_BYTES,
  MAX_TRANSACTION_FILE_DISPLAY_NAME_LENGTH,
  MAX_TRANSACTION_FILE_NAME_LENGTH,
  MAX_TRANSACTION_FILES,
  transactionFileTypeForName,
  type TransactionFileType,
} from "../lib/transaction-files";

const UPLOAD_BATCH_TTL_MS = 60 * 60 * 1000;

const fileDescriptorValidator = v.object({
  originalName: v.string(),
  displayName: v.optional(v.string()),
  mimeType: transactionFileTypeValidator,
  sizeBytes: v.number(),
  order: v.number(),
});

const retainedFileValidator = v.object({
  fileId: v.id("transactionFiles"),
  displayName: v.optional(v.string()),
  order: v.number(),
});

const verifiedFileValidator = v.object({
  fileId: v.id("transactionFiles"),
  sizeBytes: v.number(),
  etag: v.optional(v.string()),
});

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

function validationError(message: string): never {
  throw new ConvexError({ code: "VALIDATION_ERROR", message });
}

function validatedOriginalName(name: string, mimeType: TransactionFileType) {
  const normalized = requireText(name, "El nombre del archivo", MAX_TRANSACTION_FILE_NAME_LENGTH);
  if (normalized.includes("/") || normalized.includes("\\") || /[\u0000-\u001f\u007f]/.test(normalized)) {
    validationError("El nombre del archivo no es válido.");
  }
  if (transactionFileTypeForName(normalized) !== mimeType) {
    validationError("La extensión y el tipo del archivo no coinciden.");
  }
  return normalized;
}

function validatedDisplayName(name: string | undefined) {
  return optionalText(name, MAX_TRANSACTION_FILE_DISPLAY_NAME_LENGTH);
}

function validatedOrder(order: number) {
  if (!Number.isSafeInteger(order) || order < 0 || order >= MAX_TRANSACTION_FILES) {
    validationError("El orden de los archivos no es válido.");
  }
  return order;
}

function validatedSize(sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_TRANSACTION_FILE_BYTES) {
    validationError("Cada archivo debe pesar 2 MB o menos.");
  }
  return sizeBytes;
}

async function requireOwnedTransaction(
  ctx: DatabaseContext,
  transactionId: Id<"transactions">,
  ownerId: string,
  accountId: Id<"accounts">,
) {
  const transaction = await ctx.db.get(transactionId);
  if (!transaction || transaction.ownerId !== ownerId) {
    throw new ConvexError({
      code: "TRANSACTION_NOT_FOUND",
      message: "No encontramos este movimiento.",
    });
  }
  await requireOwnedWallet(ctx, transaction.walletId, ownerId, accountId);
  return transaction;
}

async function readyFilesForTransaction(
  ctx: DatabaseContext,
  transactionId: Id<"transactions">,
) {
  const files = await ctx.db
    .query("transactionFiles")
    .withIndex("by_transaction", (q) => q.eq("transactionId", transactionId))
    .collect();
  return files.filter((file) => file.status === "ready");
}

async function queueObjectDeletions(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  objectKeys: string[],
  reason: string,
) {
  if (!objectKeys.length) return;
  const now = Date.now();
  const jobIds = await Promise.all(
    objectKeys.map((objectKey) =>
      ctx.db.insert("r2DeletionJobs", {
        accountId,
        objectKey,
        reason,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );
  await ctx.scheduler.runAfter(0, internal.r2.processDeletionJobs, { jobIds });
}

function publicFile(file: Doc<"transactionFiles">) {
  return {
    _id: file._id,
    transactionId: file.transactionId,
    originalName: file.originalName,
    displayName: file.displayName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    order: file.order,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export async function publicTransactionFiles(
  ctx: DatabaseContext,
  transactionId: Id<"transactions">,
) {
  const files = await readyFilesForTransaction(ctx, transactionId);
  return files.sort((a, b) => a.order - b.order).map(publicFile);
}

export const beginUpload = mutation({
  args: {
    walletId: v.id("wallets"),
    transactionId: v.optional(v.id("transactions")),
    retainedFileIds: v.array(v.id("transactionFiles")),
    files: v.array(fileDescriptorValidator),
  },
  handler: async (ctx, args) => {
    const { ownerId, user, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    await requireFeature(ctx, account._id, "transactions.files");
    const wallet = await requireOwnedWallet(ctx, args.walletId, ownerId, account._id);
    if (wallet.archivedAt) {
      throw new ConvexError({
        code: "WALLET_ARCHIVED",
        message: "Restaurá el bolsillo para adjuntar archivos.",
      });
    }
    if (args.files.length < 1 || args.files.length > MAX_TRANSACTION_FILES) {
      validationError(`Podés adjuntar hasta ${MAX_TRANSACTION_FILES} archivos por movimiento.`);
    }

    let existingCount = 0;
    if (args.transactionId) {
      const transaction = await requireOwnedTransaction(
        ctx,
        args.transactionId,
        ownerId,
        account._id,
      );
      if (transaction.walletId !== args.walletId) {
        validationError("El movimiento no pertenece a este bolsillo.");
      }
      const existingFiles = await readyFilesForTransaction(ctx, transaction._id);
      const existingIds = new Set(existingFiles.map(({ _id }) => _id));
      const retainedIds = new Set(args.retainedFileIds);
      if (
        retainedIds.size !== args.retainedFileIds.length ||
        args.retainedFileIds.some((fileId) => !existingIds.has(fileId))
      ) {
        validationError("La lista de archivos no es válida.");
      }
      existingCount = retainedIds.size;
    } else if (args.retainedFileIds.length) {
      validationError("La lista de archivos no es válida.");
    }
    if (existingCount + args.files.length > MAX_TRANSACTION_FILES) {
      validationError(`Podés adjuntar hasta ${MAX_TRANSACTION_FILES} archivos por movimiento.`);
    }

    const descriptors = args.files.map((file) => ({
      originalName: validatedOriginalName(file.originalName, file.mimeType),
      displayName: validatedDisplayName(file.displayName),
      mimeType: file.mimeType,
      sizeBytes: validatedSize(file.sizeBytes),
      order: validatedOrder(file.order),
    }));
    if (new Set(descriptors.map(({ order }) => order)).size !== descriptors.length) {
      validationError("El orden de los archivos no es válido.");
    }

    const now = Date.now();
    const expiresAt = now + UPLOAD_BATCH_TTL_MS;
    const batchId = await ctx.db.insert("fileUploadBatches", {
      accountId: account._id,
      walletId: args.walletId,
      targetTransactionId: args.transactionId,
      createdByUserId: user._id,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    const fileIds = [] as Id<"transactionFiles">[];
    for (const descriptor of descriptors) {
      const fileId = await ctx.db.insert("transactionFiles", {
        accountId: account._id,
        walletId: args.walletId,
        uploadBatchId: batchId,
        createdByUserId: user._id,
        objectKey: "pending",
        ...descriptor,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });
      await ctx.db.patch(fileId, {
        objectKey: `accounts/${account._id}/transaction-files/${fileId}`,
      });
      fileIds.push(fileId);
    }
    await ctx.scheduler.runAfter(UPLOAD_BATCH_TTL_MS, internal.r2.cleanupExpiredBatch, {
      batchId,
    });
    return { batchId, fileIds, expiresAt };
  },
});

export const abortUpload = mutation({
  args: { batchId: v.id("fileUploadBatches") },
  handler: async (ctx, { batchId }) => {
    const { account } = await requireAccountContext(ctx);
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.accountId !== account._id || batch.status === "committed") return;
    const files = await ctx.db
      .query("transactionFiles")
      .withIndex("by_batch", (q) => q.eq("uploadBatchId", batchId))
      .collect();
    await queueObjectDeletions(
      ctx,
      account._id,
      files.map(({ objectKey }) => objectKey),
      "upload_aborted",
    );
    await Promise.all(files.map(({ _id }) => ctx.db.delete(_id)));
    await ctx.db.delete(batchId);
  },
});

export const listByTransaction = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, { transactionId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.files");
    await requireOwnedTransaction(ctx, transactionId, ownerId, account._id);
    return await publicTransactionFiles(ctx, transactionId);
  },
});

export const updateTransactionWithFiles = mutation({
  args: {
    transactionId: v.id("transactions"),
    files: v.array(retainedFileValidator),
    ...transactionFields,
  },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    await requireFeature(ctx, account._id, "transactions.files");
    const transaction = await requireOwnedTransaction(
      ctx,
      args.transactionId,
      ownerId,
      account._id,
    );
    const wallet = await requireOwnedWallet(ctx, transaction.walletId, ownerId, account._id);
    if (wallet.archivedAt) {
      throw new ConvexError({
        code: "WALLET_ARCHIVED",
        message: "Restaurá el bolsillo para editar movimientos.",
      });
    }
    if (args.files.length > MAX_TRANSACTION_FILES) {
      validationError(`Podés adjuntar hasta ${MAX_TRANSACTION_FILES} archivos por movimiento.`);
    }
    const currentFiles = await readyFilesForTransaction(ctx, transaction._id);
    const currentById = new Map(currentFiles.map((file) => [file._id, file]));
    const requestedIds = new Set(args.files.map(({ fileId }) => fileId));
    if (requestedIds.size !== args.files.length) validationError("La lista de archivos no es válida.");
    for (const file of args.files) {
      if (!currentById.has(file.fileId)) validationError("Uno de los archivos no es válido.");
      validatedOrder(file.order);
    }
    if (new Set(args.files.map(({ order }) => order)).size !== args.files.length) {
      validationError("El orden de los archivos no es válido.");
    }
    const removed = currentFiles.filter(({ _id }) => !requestedIds.has(_id));
    await queueObjectDeletions(
      ctx,
      account._id,
      removed.map(({ objectKey }) => objectKey),
      "file_removed",
    );
    await Promise.all(removed.map(({ _id }) => ctx.db.delete(_id)));
    await Promise.all(
      args.files.map((file) =>
        ctx.db.patch(file.fileId, {
          displayName: validatedDisplayName(file.displayName),
          order: file.order,
          updatedAt: Date.now(),
        }),
      ),
    );
    const tagIds = await validateAssignedTagIds(
      ctx,
      args.tagIds,
      transaction.walletId,
      ownerId,
    );
    await ctx.db.patch(transaction._id, {
      ...validatedTransactionFields(args),
      tagIds,
      fileCount: args.files.length,
      updatedAt: Date.now(),
    });
  },
});

export async function deleteTransactionFiles(
  ctx: MutationCtx,
  transactionId: Id<"transactions">,
  accountId: Id<"accounts">,
) {
  const files = await readyFilesForTransaction(ctx, transactionId);
  await queueObjectDeletions(
    ctx,
    accountId,
    files.map(({ objectKey }) => objectKey),
    "transaction_deleted",
  );
  await Promise.all(files.map(({ _id }) => ctx.db.delete(_id)));
}

export const getBatchForUpload = internalQuery({
  args: { batchId: v.id("fileUploadBatches") },
  handler: async (ctx, { batchId }) => {
    const { account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.files");
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.accountId !== account._id) {
      throw new ConvexError({ code: "UPLOAD_NOT_FOUND", message: "La carga ya no está disponible." });
    }
    const files = await ctx.db
      .query("transactionFiles")
      .withIndex("by_batch", (q) => q.eq("uploadBatchId", batchId))
      .collect();
    return { batch, files };
  },
});

export const getFileForRead = internalQuery({
  args: { fileId: v.id("transactionFiles") },
  handler: async (ctx, { fileId }) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.files");
    const file = await ctx.db.get(fileId);
    if (
      !file ||
      file.accountId !== account._id ||
      file.status !== "ready" ||
      !file.transactionId
    ) {
      throw new ConvexError({ code: "FILE_NOT_FOUND", message: "No encontramos este archivo." });
    }
    await requireOwnedTransaction(ctx, file.transactionId, ownerId, account._id);
    return file;
  },
});

export const commitUploadBatch = internalMutation({
  args: {
    batchId: v.id("fileUploadBatches"),
    retainedFiles: v.array(retainedFileValidator),
    verifiedFiles: v.array(verifiedFileValidator),
    ...transactionFields,
  },
  handler: async (ctx, args) => {
    const { ownerId, account } = await requireAccountContext(ctx);
    await requireFeature(ctx, account._id, "transactions.manage");
    await requireFeature(ctx, account._id, "transactions.files");
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.accountId !== account._id) {
      throw new ConvexError({ code: "UPLOAD_NOT_FOUND", message: "La carga ya no está disponible." });
    }
    if (batch.status === "committed" && batch.committedTransactionId) {
      return batch.committedTransactionId;
    }
    if (batch.expiresAt < Date.now()) {
      throw new ConvexError({ code: "UPLOAD_EXPIRED", message: "La carga venció. Intentá de nuevo." });
    }
    const pendingFiles = await ctx.db
      .query("transactionFiles")
      .withIndex("by_batch", (q) => q.eq("uploadBatchId", batch._id))
      .collect();
    const verifiedById = new Map(args.verifiedFiles.map((file) => [file.fileId, file]));
    if (
      pendingFiles.length < 1 ||
      pendingFiles.length !== args.verifiedFiles.length ||
      verifiedById.size !== args.verifiedFiles.length ||
      pendingFiles.some((file) => !verifiedById.has(file._id))
    ) {
      validationError("No se pudieron verificar todos los archivos.");
    }

    let transaction: Doc<"transactions"> | null = null;
    let currentFiles: Doc<"transactionFiles">[] = [];
    if (batch.targetTransactionId) {
      transaction = await requireOwnedTransaction(
        ctx,
        batch.targetTransactionId,
        ownerId,
        account._id,
      );
      currentFiles = await readyFilesForTransaction(ctx, transaction._id);
    } else if (args.retainedFiles.length) {
      validationError("La lista de archivos no es válida.");
    }

    const currentById = new Map(currentFiles.map((file) => [file._id, file]));
    const retainedIds = new Set(args.retainedFiles.map(({ fileId }) => fileId));
    if (retainedIds.size !== args.retainedFiles.length) {
      validationError("La lista de archivos no es válida.");
    }
    for (const file of args.retainedFiles) {
      if (!currentById.has(file.fileId)) validationError("Uno de los archivos no es válido.");
      validatedOrder(file.order);
    }
    const allOrders = [
      ...args.retainedFiles.map(({ order }) => order),
      ...pendingFiles.map(({ order }) => order),
    ];
    if (
      retainedIds.size + pendingFiles.length > MAX_TRANSACTION_FILES ||
      new Set(allOrders).size !== allOrders.length
    ) {
      validationError(`Podés adjuntar hasta ${MAX_TRANSACTION_FILES} archivos por movimiento.`);
    }

    const wallet = await requireOwnedWallet(ctx, batch.walletId, ownerId, account._id);
    if (wallet.archivedAt) {
      throw new ConvexError({
        code: "WALLET_ARCHIVED",
        message: "Restaurá el bolsillo para editar movimientos.",
      });
    }
    if (transaction && transaction.walletId !== batch.walletId) {
      validationError("El movimiento no pertenece a este bolsillo.");
    }
    const tagIds = await validateAssignedTagIds(ctx, args.tagIds, batch.walletId, ownerId);
    const now = Date.now();
    const transactionId = transaction
      ? transaction._id
      : await ctx.db.insert("transactions", {
          ownerId,
          walletId: batch.walletId,
          ...validatedTransactionFields(args),
          tagIds,
          fileCount: retainedIds.size + pendingFiles.length,
          createdAt: now,
          updatedAt: now,
        });
    if (transaction) {
      await ctx.db.patch(transaction._id, {
        ...validatedTransactionFields(args),
        tagIds,
        fileCount: retainedIds.size + pendingFiles.length,
        updatedAt: now,
      });
    }

    const removed = currentFiles.filter(({ _id }) => !retainedIds.has(_id));
    await queueObjectDeletions(
      ctx,
      account._id,
      removed.map(({ objectKey }) => objectKey),
      "file_removed",
    );
    await Promise.all(removed.map(({ _id }) => ctx.db.delete(_id)));
    await Promise.all(
      args.retainedFiles.map((file) =>
        ctx.db.patch(file.fileId, {
          displayName: validatedDisplayName(file.displayName),
          order: file.order,
          updatedAt: now,
        }),
      ),
    );
    await Promise.all(
      pendingFiles.map((file) => {
        const verified = verifiedById.get(file._id)!;
        return ctx.db.patch(file._id, {
          transactionId,
          status: "ready",
          sizeBytes: validatedSize(verified.sizeBytes),
          etag: verified.etag,
          expiresAt: undefined,
          updatedAt: now,
        });
      }),
    );
    await ctx.db.patch(batch._id, {
      status: "committed",
      committedTransactionId: transactionId,
      updatedAt: now,
    });
    return transactionId;
  },
});

export const getBatchForCleanup = internalQuery({
  args: { batchId: v.id("fileUploadBatches") },
  handler: async (ctx, { batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch) return null;
    const files = await ctx.db
      .query("transactionFiles")
      .withIndex("by_batch", (q) => q.eq("uploadBatchId", batchId))
      .collect();
    return { batch, files };
  },
});

export const completeBatchCleanup = internalMutation({
  args: { batchId: v.id("fileUploadBatches") },
  handler: async (ctx, { batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch) return;
    if (batch.status === "pending") {
      const files = await ctx.db
        .query("transactionFiles")
        .withIndex("by_batch", (q) => q.eq("uploadBatchId", batchId))
        .collect();
      await Promise.all(files.map(({ _id }) => ctx.db.delete(_id)));
    }
    await ctx.db.delete(batchId);
  },
});

export const abandonBatchToDeletionJobs = internalMutation({
  args: { batchId: v.id("fileUploadBatches"), error: v.string() },
  handler: async (ctx, { batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.status !== "pending") return;
    const files = await ctx.db
      .query("transactionFiles")
      .withIndex("by_batch", (q) => q.eq("uploadBatchId", batchId))
      .collect();
    await queueObjectDeletions(
      ctx,
      batch.accountId,
      files.map(({ objectKey }) => objectKey),
      "expired_upload",
    );
    await Promise.all(files.map(({ _id }) => ctx.db.delete(_id)));
    await ctx.db.delete(batchId);
  },
});

export const getDeletionJobs = internalQuery({
  args: { jobIds: v.array(v.id("r2DeletionJobs")) },
  handler: async (ctx, { jobIds }) => {
    const jobs = await Promise.all(jobIds.map((jobId) => ctx.db.get(jobId)));
    return jobs.filter((job): job is Doc<"r2DeletionJobs"> => Boolean(job));
  },
});

export const applyDeletionResults = internalMutation({
  args: {
    succeeded: v.array(v.id("r2DeletionJobs")),
    failed: v.array(v.object({ jobId: v.id("r2DeletionJobs"), error: v.string() })),
  },
  handler: async (ctx, { succeeded, failed }) => {
    await Promise.all(
      succeeded.map(async (jobId) => {
        if (await ctx.db.get(jobId)) await ctx.db.delete(jobId);
      }),
    );
    if (!failed.length) return;
    const now = Date.now();
    let nextDelay = 6 * 60 * 60 * 1000;
    const retryIds = [] as Id<"r2DeletionJobs">[];
    for (const failure of failed) {
      const job = await ctx.db.get(failure.jobId);
      if (!job) continue;
      const attempts = job.attempts + 1;
      const delay = Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempts, 8));
      nextDelay = Math.min(nextDelay, delay);
      await ctx.db.patch(job._id, {
        attempts,
        nextAttemptAt: now + delay,
        lastError: failure.error.slice(0, 500),
        updatedAt: now,
      });
      retryIds.push(job._id);
    }
    if (retryIds.length) {
      await ctx.scheduler.runAfter(nextDelay, internal.r2.processDeletionJobs, {
        jobIds: retryIds,
      });
    }
  },
});

export const reconcileStorageCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [jobs, batches] = await Promise.all([
      ctx.db
        .query("r2DeletionJobs")
        .withIndex("by_next_attempt", (q) => q.lte("nextAttemptAt", now))
        .take(50),
      ctx.db
        .query("fileUploadBatches")
        .withIndex("by_expiration", (q) => q.lte("expiresAt", now))
        .take(20),
    ]);
    if (jobs.length) {
      await ctx.scheduler.runAfter(0, internal.r2.processDeletionJobs, {
        jobIds: jobs.map(({ _id }) => _id),
      });
    }
    for (const batch of batches) {
      await ctx.scheduler.runAfter(0, internal.r2.cleanupExpiredBatch, {
        batchId: batch._id,
      });
    }
  },
});
