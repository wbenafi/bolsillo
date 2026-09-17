import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { S3Client } from "@aws-sdk/client-s3";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ActionCtx } from "../../convex/_generated/server";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";
import { queueObjectDeletions } from "../../convex/transactionFiles";

// Runs unchanged against the baseline and working tree. No cloud calls or R2
// credentials: the workload reproduces the observed four unconfigured jobs.
it("replays 24 hours of two deletion chains plus hourly reconciliation", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
  const start = Date.now();
  for (const name of ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_LOCAL_ENDPOINT"]) vi.stubEnv(name, "");
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(() => { throw new Error("Unexpected R2 request"); });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let actionDurationMs = 0;
  let actionStarts = 0;
  const t = convexTest(schema, {
    ...modules,
    "./r2.ts": async () => {
      const mod = await modules["./r2.ts"]() as typeof import("../../convex/r2");
      // convex-test executes this registration field instead of invokeAction.
      const action = mod.processDeletionJobs as typeof mod.processDeletionJobs & {
        _handler: (ctx: ActionCtx, args: { jobIds: Id<"r2DeletionJobs">[] }) => Promise<void>;
      };
      return { ...mod, processDeletionJobs: { ...action, _handler: async (...args: Parameters<typeof action._handler>) => {
        const began = performance.now();
        actionStarts++;
        try { return await action._handler(...args); }
        finally { actionDurationMs += performance.now() - began; }
      } } };
    },
  });
  try {
    const user = t.withIdentity({ subject: "cleanup-replay" });
    await user.mutation(api.users.ensureCurrent, {});
    const viewer = (await user.query(api.users.current, {}))!;
    await t.run(async (ctx) => {
      await queueObjectDeletions(ctx, viewer.account._id, ["replay/0", "replay/1"], "upload_aborted");
      await queueObjectDeletions(ctx, viewer.account._id, ["replay/2", "replay/3"], "upload_aborted");
      for (const job of await ctx.db.query("r2DeletionJobs").collect()) await ctx.db.patch(job._id, { attempts: 103 });
    });
    const wallStarted = performance.now();
    for (let hour = 0; hour < 24; hour++) {
      await vi.advanceTimersByTimeAsync(start + hour * 3_600_000 - Date.now());
      await t.finishInProgressScheduledFunctions();
      await t.mutation(internal.transactionFiles.reconcileStorageCleanup, {});
      // Drain newly scheduled immediate dispatches/actions without jumping ahead
      // to future retries. Advancing one millisecond also handles nested timers.
      for (let step = 0; step < 10; step++) {
        await vi.advanceTimersByTimeAsync(1);
        await t.finishInProgressScheduledFunctions();
      }
    }
    await vi.advanceTimersByTimeAsync(start + 24 * 3_600_000 - Date.now());
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) => ctx.db.query("r2DeletionJobs").collect());
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(actionStarts).toBe(scheduled.filter((s) => s.name === "r2:processDeletionJobs" && s.state.kind === "success").length);
    const result = {
      workloadHours: 24, initialJobs: 4, initialAttemptsPerJob: 103, reconciliations: 24,
      actionStarts, jobAttempts: jobs.reduce((sum, job) => sum + job.attempts - 103, 0),
      usefulDeletions: 4 - jobs.length, r2Requests: send.mock.calls.length,
      remainingJobs: jobs.length, pendingSchedules: scheduled.filter((s) => s.state.kind === "pending").length,
      actionDurationMs, replayWallMs: performance.now() - wallStarted,
      // A duration × memory comparison, not hosted/billed Convex compute.
      localDurationEquivalentGbHoursAt512MiB: actionDurationMs * 0.5 / 3_600_000,
    };
    expect(result.remainingJobs).toBe(4);
    expect(result.r2Requests).toBe(0);
    if (!process.env.BOLSILLO_CLEANUP_REPORT) throw new Error("Run npm run test:cleanup:compare");
    writeFileSync(process.env.BOLSILLO_CLEANUP_REPORT, JSON.stringify(result, null, 2) + "\n");
  } finally {
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  }
});
