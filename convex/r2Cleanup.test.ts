// @vitest-environment node
import { S3Client } from "@aws-sdk/client-s3";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { deletionRetryDelay, R2_DELETION_MAX_RETRY_MS } from "../lib/r2-cleanup";

const configuration = {
  R2_ACCOUNT_ID: "test-account", R2_BUCKET_NAME: "test-bucket",
  R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret",
};

async function setup(count = 1, attempts = 0) {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "cleanup-test" });
  await asUser.mutation(api.users.ensureCurrent, {});
  const viewer = (await asUser.query(api.users.current, {}))!;
  const jobIds = await t.run(async (ctx) => {
    const ids: Id<"r2DeletionJobs">[] = [];
    for (let i = 0; i < count; i++) ids.push(await ctx.db.insert("r2DeletionJobs", {
      accountId: viewer.account._id, objectKey: `test/${i}`, reason: "upload_aborted",
      attempts, nextAttemptAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    }));
    return ids;
  });
  return { t, asUser, viewer, jobIds };
}

describe("R2 deletion cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const [key, value] of Object.entries(configuration)) vi.stubEnv(key, value);
    vi.stubEnv("R2_LOCAL_ENDPOINT", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({ $metadata: { attempts: 1 } }));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does no work for an empty queue or missing job IDs", async () => {
    const { t, jobIds } = await setup();
    await t.run((ctx) => ctx.db.delete(jobIds[0]));
    await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds });
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
    expect(S3Client.prototype.send).not.toHaveBeenCalled();
  });

  it("retains unconfigured development work and automatically drains it after configuration returns", async () => {
    const { t, jobIds } = await setup(4, 103);
    for (const key of Object.keys(configuration)) vi.stubEnv(key, "");
    for (let hour = 0; hour < 24; hour++) {
      await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    const jobs = await t.run((ctx) => ctx.db.query("r2DeletionJobs").collect());
    expect(jobs).toHaveLength(4);
    expect(jobs.every((job) => job.attempts === 103)).toBe(true);
    expect(S3Client.prototype.send).not.toHaveBeenCalled();
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.every((s) => s.name === "transactionFiles:dispatchDeletionJobs")).toBe(true);
    for (const [key, value] of Object.entries(configuration)) vi.stubEnv(key, value);
    await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(1);
    expect(await t.query(internal.transactionFiles.getDeletionJobs, { jobIds })).toEqual([]);
  });

  it("supports configured local storage without a cloud account ID", async () => {
    const { t, jobIds } = await setup();
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("R2_LOCAL_ENDPOINT", "http://127.0.0.1:9000");
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(1);
  });

  it("lets a legacy scheduled action settle without perpetuating unconfigured action retries", async () => {
    const { t, jobIds } = await setup(2, 103);
    vi.stubEnv("R2_BUCKET_NAME", "");
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const jobs = await t.run((ctx) => ctx.db.query("r2DeletionJobs").collect());
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.attempts === 104)).toBe(true);
    expect(S3Client.prototype.send).not.toHaveBeenCalled();
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.every((s) => s.state.kind === "success" && s.name === "transactionFiles:dispatchDeletionJobs")).toBe(true);
  });

  it.each(["pending", "committed"] as const)("preserves cleanup of an expired %s upload batch", async (status) => {
    const { t, asUser, viewer } = await setup(0);
    const walletId = await asUser.mutation(api.wallets.createWallet, { name: "Expired files", currency: "USD" });
    const { batchId, fileId } = await t.run(async (ctx) => {
      const batchId = await ctx.db.insert("fileUploadBatches", {
        accountId: viewer.account._id, walletId, createdByUserId: viewer.user._id,
        status, createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000, expiresAt: Date.now() - 1,
      });
      const fileId = await ctx.db.insert("transactionFiles", {
        accountId: viewer.account._id, walletId, uploadBatchId: batchId, createdByUserId: viewer.user._id,
        objectKey: "expired/0", originalName: "test.txt", mimeType: "text/plain", sizeBytes: 1, order: 0,
        status: status === "committed" ? "ready" : "pending", createdAt: Date.now(), updatedAt: Date.now(),
      });
      return { batchId, fileId };
    });
    vi.stubEnv("R2_BUCKET_NAME", "");
    await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(batchId))).toBeNull();
    const file = await t.run((ctx) => ctx.db.get(fileId));
    const jobs = await t.run((ctx) => ctx.db.query("r2DeletionJobs").collect());
    if (status === "committed") {
      expect(file).not.toBeNull();
      expect(jobs).toHaveLength(0);
    } else {
      expect(file).toBeNull();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ objectKey: "expired/0", reason: "expired_upload" });
      vi.stubEnv("R2_BUCKET_NAME", configuration.R2_BUCKET_NAME);
      await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.query("r2DeletionJobs").collect())).toHaveLength(0);
    }
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(status === "committed" ? 0 : 1);
  });

  it("deduplicates dispatches and chunks large queues into at most 50 objects per action", async () => {
    const { t, jobIds } = await setup(101);
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds: [...jobIds, jobIds[0]] });
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds });
    await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(S3Client.prototype.send).mock.calls.map(([command]) =>
      (command.input as { Delete: { Objects: unknown[] } }).Delete.Objects.length,
    ).sort((a, b) => a - b)).toEqual([1, 50, 50]);
    expect(await t.run((ctx) => ctx.db.query("r2DeletionJobs").collect())).toEqual([]);
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(3);
  });

  it("recovers a canceled scheduled action through reconciliation", async () => {
    const { t, jobIds } = await setup();
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds });
    await t.run(async (ctx) => {
      const job = (await ctx.db.get(jobIds[0]))!;
      await ctx.scheduler.cancel(job.scheduledFunctionId!);
    });
    await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure only when due and then completes deletion", async () => {
    const { t, jobIds } = await setup();
    vi.mocked(S3Client.prototype.send).mockRejectedValueOnce(new Error("connection reset"));
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    const failed = await t.run((ctx) => ctx.db.get(jobIds[0]));
    expect(failed).toMatchObject({ attempts: 1, lastError: "connection reset", nextAttemptAt: Date.now() + 120_000 });
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds });
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(2);
    expect(await t.run((ctx) => ctx.db.get(jobIds[0]))).toBeNull();
  });

  it("retains permanent failures with bounded backoff and respects different retry deadlines", async () => {
    const { t, jobIds } = await setup(2);
    await t.run((ctx) => ctx.db.patch(jobIds[1], { attempts: 103 }));
    vi.mocked(S3Client.prototype.send).mockRejectedValue(new Error("AccessDenied"));
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    const jobs = await t.run((ctx) => Promise.all(jobIds.map((id) => ctx.db.get(id))));
    expect(jobs[0]).toMatchObject({ attempts: 1, nextAttemptAt: Date.now() + 120_000, lastError: "AccessDenied" });
    expect(jobs[1]).toMatchObject({ attempts: 104, nextAttemptAt: Date.now() + R2_DELETION_MAX_RETRY_MS, lastError: "AccessDenied" });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => s.scheduledTime).sort()).toEqual([Date.now() + 120_000, Date.now() + R2_DELETION_MAX_RETRY_MS].sort());
    expect(deletionRetryDelay(9)).toBe(R2_DELETION_MAX_RETRY_MS);
    expect(deletionRetryDelay(1000)).toBe(R2_DELETION_MAX_RETRY_MS);
  });

  it("keeps per-object R2 errors, including empty messages, and only retries failed objects", async () => {
    const { t, jobIds } = await setup(2);
    vi.mocked(S3Client.prototype.send).mockImplementationOnce(async () => ({
      $metadata: { attempts: 1 }, Errors: [{ Key: "test/1", Code: "AccessDenied", Message: "" }],
    }));
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    expect(await t.run((ctx) => ctx.db.get(jobIds[0]))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(jobIds[1]))).toMatchObject({ attempts: 1, lastError: "AccessDenied" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(jobIds[1]))).toBeNull();
  });

  it.each(["pending", "ready"] as const)("protects %s file references, including legacy direct actions", async (status) => {
    const { t, asUser, viewer, jobIds } = await setup();
    const walletId = await asUser.mutation(api.wallets.createWallet, { name: "Files", currency: "USD" });
    const fileId = await t.run(async (ctx) => {
      const batchId = await ctx.db.insert("fileUploadBatches", {
        accountId: viewer.account._id, walletId, createdByUserId: viewer.user._id,
        status: "pending", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 1000,
      });
      return ctx.db.insert("transactionFiles", {
        accountId: viewer.account._id, walletId, uploadBatchId: batchId, createdByUserId: viewer.user._id,
        objectKey: "test/0", originalName: "test.txt", mimeType: "text/plain", sizeBytes: 1, order: 0,
        status, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await t.action(internal.r2.processDeletionJobs, { jobIds });
    await t.mutation(internal.transactionFiles.dispatchDeletionJobs, { jobIds });
    expect(S3Client.prototype.send).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(fileId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(jobIds[0]))).toMatchObject({ attempts: 0, lastError: "FILE_STILL_REFERENCED" });
    await t.run(async (ctx) => {
      await ctx.db.delete(fileId);
      await ctx.db.patch(jobIds[0], { nextAttemptAt: Date.now() });
    });
    await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(S3Client.prototype.send).toHaveBeenCalledTimes(1);
  });
});
