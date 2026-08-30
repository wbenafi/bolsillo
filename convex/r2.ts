"use node";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { transactionFields } from "./transactionDomain";
import { contentMatchesFileType } from "../lib/transaction-file-content";
import { MAX_TRANSACTION_FILE_BYTES, type TransactionFileType } from "../lib/transaction-files";

const retainedFileValidator = v.object({
  fileId: v.id("transactionFiles"),
  displayName: v.optional(v.string()),
  order: v.number(),
});

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConvexError({
      code: "R2_NOT_CONFIGURED",
      message: "El almacenamiento de archivos todavía no está configurado.",
    });
  }
  return value;
}

function r2Configuration() {
  const accountId = requiredEnvironment("R2_ACCOUNT_ID");
  const bucket = requiredEnvironment("R2_BUCKET_NAME");
  const accessKeyId = requiredEnvironment("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnvironment("R2_SECRET_ACCESS_KEY");
  const requestedTtl = Number(process.env.R2_PRESIGN_TTL_SECONDS ?? "300");
  const expiresIn = Number.isFinite(requestedTtl)
    ? Math.max(60, Math.min(900, Math.floor(requestedTtl)))
    : 300;
  return {
    bucket,
    expiresIn,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
}

function fileError(message: string): never {
  throw new ConvexError({ code: "FILE_VALIDATION_ERROR", message });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido de R2";
}

export const createUploadUrls = action({
  args: { batchId: v.id("fileUploadBatches") },
  handler: async (ctx, { batchId }): Promise<{
    uploads: Array<{
      fileId: Id<"transactionFiles">;
      url: string;
      headers: Record<string, string>;
    }>;
    expiresAt: number;
  }> => {
    const { batch, files } = await ctx.runQuery(internal.transactionFiles.getBatchForUpload, {
      batchId,
    });
    if (batch.status !== "pending" || batch.expiresAt < Date.now()) {
      throw new ConvexError({ code: "UPLOAD_EXPIRED", message: "La carga venció. Intentá de nuevo." });
    }
    const { client, bucket, expiresIn } = r2Configuration();
    const uploads = await Promise.all(
      files.map(async (file) => ({
        fileId: file._id,
        url: await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: file.objectKey,
            ContentType: file.mimeType,
            IfNoneMatch: "*",
          }),
          { expiresIn },
        ),
        headers: {
          "Content-Type": file.mimeType,
          "If-None-Match": "*",
        },
      })),
    );
    return { uploads, expiresAt: Date.now() + expiresIn * 1000 };
  },
});

async function verifiedR2File(
  client: S3Client,
  bucket: string,
  file: {
    _id: Id<"transactionFiles">;
    objectKey: string;
    originalName: string;
    mimeType: TransactionFileType;
    sizeBytes: number;
  },
) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }),
  );
  if (!response.Body) fileError(`No se pudo leer ${file.originalName}.`);
  const bytes = await response.Body.transformToByteArray();
  const contentType = response.ContentType?.split(";", 1)[0]?.trim().toLocaleLowerCase("en");
  if (
    bytes.length < 1 ||
    bytes.length > MAX_TRANSACTION_FILE_BYTES ||
    bytes.length !== file.sizeBytes ||
    contentType !== file.mimeType ||
    !contentMatchesFileType(bytes, file.mimeType)
  ) {
    fileError(`${file.originalName} no coincide con el tipo o tamaño permitido.`);
  }
  return {
    fileId: file._id,
    sizeBytes: bytes.length,
    etag: response.ETag?.replaceAll('"', ""),
  };
}

export const finalizeUpload = action({
  args: {
    batchId: v.id("fileUploadBatches"),
    retainedFiles: v.array(retainedFileValidator),
    ...transactionFields,
  },
  handler: async (ctx, args): Promise<Id<"transactions">> => {
    const { batch, files } = await ctx.runQuery(internal.transactionFiles.getBatchForUpload, {
      batchId: args.batchId,
    });
    if (batch.status === "committed" && batch.committedTransactionId) {
      return batch.committedTransactionId;
    }
    if (batch.expiresAt < Date.now()) {
      throw new ConvexError({ code: "UPLOAD_EXPIRED", message: "La carga venció. Intentá de nuevo." });
    }
    const { client, bucket } = r2Configuration();
    const verifiedFiles = await Promise.all(
      files.map((file) => verifiedR2File(client, bucket, file)),
    );
    return await ctx.runMutation(internal.transactionFiles.commitUploadBatch, {
      ...args,
      verifiedFiles,
    });
  },
});

export const createReadUrl = action({
  args: { fileId: v.id("transactionFiles") },
  handler: async (ctx, { fileId }): Promise<{
    url: string;
    expiresAt: number;
    originalName: string;
    displayName?: string;
    mimeType: TransactionFileType;
  }> => {
    const file = await ctx.runQuery(internal.transactionFiles.getFileForRead, { fileId });
    const { client, bucket, expiresIn } = r2Configuration();
    return {
      url: await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }),
        { expiresIn },
      ),
      expiresAt: Date.now() + expiresIn * 1000,
      originalName: file.originalName,
      displayName: file.displayName,
      mimeType: file.mimeType,
    };
  },
});

export const cleanupExpiredBatch = internalAction({
  args: { batchId: v.id("fileUploadBatches") },
  handler: async (ctx, { batchId }): Promise<void> => {
    const data = await ctx.runQuery(internal.transactionFiles.getBatchForCleanup, { batchId });
    if (!data || data.batch.expiresAt > Date.now()) return;
    if (data.batch.status === "committed") {
      await ctx.runMutation(internal.transactionFiles.completeBatchCleanup, { batchId });
      return;
    }
    try {
      if (data.files.length) {
        const { client, bucket } = r2Configuration();
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: data.files.map(({ objectKey: Key }) => ({ Key })) },
          }),
        );
      }
      await ctx.runMutation(internal.transactionFiles.completeBatchCleanup, { batchId });
    } catch (error) {
      await ctx.runMutation(internal.transactionFiles.abandonBatchToDeletionJobs, {
        batchId,
        error: errorMessage(error),
      });
    }
  },
});

export const processDeletionJobs = internalAction({
  args: { jobIds: v.array(v.id("r2DeletionJobs")) },
  handler: async (ctx, { jobIds }): Promise<void> => {
    const jobs = await ctx.runQuery(internal.transactionFiles.getDeletionJobs, { jobIds });
    if (!jobs.length) return;
    try {
      const { client, bucket } = r2Configuration();
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: jobs.map(({ objectKey: Key }) => ({ Key })) },
        }),
      );
      const errorsByKey = new Map(
        (response.Errors ?? []).map((error) => [error.Key, error.Message ?? error.Code ?? "R2 rechazó la eliminación."]),
      );
      await ctx.runMutation(internal.transactionFiles.applyDeletionResults, {
        succeeded: jobs
          .filter(({ objectKey }) => !errorsByKey.has(objectKey))
          .map(({ _id }) => _id),
        failed: jobs.flatMap((job) => {
          const error = errorsByKey.get(job.objectKey);
          return error ? [{ jobId: job._id, error }] : [];
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      await ctx.runMutation(internal.transactionFiles.applyDeletionResults, {
        succeeded: [],
        failed: jobs.map((job) => ({ jobId: job._id, error: message })),
      });
    }
  },
});
