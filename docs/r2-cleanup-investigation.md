# R2 cleanup compute investigation — issue #10

The development deployment repeatedly starts Node actions for four aborted-upload
objects even though R2 is not configured. The jobs must remain durable, but a Node
action cannot make progress until configuration exists. Check configuration in a
Convex mutation before dispatching the action, and let hourly reconciliation
resume the queue automatically after configuration is restored.

## Live baseline, collected before implementation

Read-only inspection on **2026-09-17 at approximately 02:14–02:17 UTC** used the
authenticated Convex CLI and team usage API. The billing query covered September
1–30, with partial-period data. Its refreshed values matched
[issue #10](https://github.com/wbenafi/bolsillo/issues/10).

| Measurement | Development | Production |
| --- | ---: | ---: |
| September `r2:processDeletionJobs` calls | 182 | 5 |
| September Node action compute, GB-hours | 0.0455656944 | 0.0005452778 |
| September reconciliation calls | 386 | 105 |
| Current deletion queue depth | 4 | 0 |
| Failed attempts on each remaining job | 103 | — |
| Pending deletion actions | 2, each carrying 2 jobs | 0 |
| Upload batches remaining | 0 | 0 |
| File metadata records remaining | 0 | 3 |
| R2 configuration | No R2 variables | All 4 required variables present |

Development represents **98.82% of this function's measured compute**. All four
remaining jobs were created on August 30, carry reason `upload_aborted`, and have
`R2_NOT_CONFIGURED` as their last error. There are no file references to these
objects in development. The two pending schedules repeat the same two pairs of
jobs. Of 82 retained development deletion schedules, 80 completed and 2 remain
pending. No duplicate pending schedules for the same job were observed.

Recent retained completion logs provide a separate, shorter baseline:

| Measurement | Development | Production |
| --- | ---: | ---: |
| Log window, UTC | Sep 15 23:09–Sep 17 02:09 | Sep 15 23:06–Sep 17 02:15 |
| Deletion action completions | 14 | 1 |
| Total action execution time | 27.6251 s | 2.4946 s |
| Mean action execution time | 1.9732 s | 2.4946 s |
| Development duration range | 1.7339–2.2014 s | — |
| Reported action memory | 512 MiB | 512 MiB |
| Duration × memory, GB-hours | 0.00383682 | 0.000346477 |
| Reconciliation calls | 28 | 28 |
| Reconciliation database bytes read | 0 | 0 |

These development actions cannot issue R2 requests: `r2Configuration()` throws
before constructing the client. Thus R2 request time for the observed failure
mode is zero; the roughly two seconds is action startup/execution and Convex RPC
work. The old code has no separate R2 request timing, so production external R2
latency cannot be isolated retrospectively from its total action duration.
Scheduler `success` means the action returned successfully, not that deletion
worked: the action catches configuration errors and persists failures through
`applyDeletionResults`.

The empty-queue and hourly-cron hypotheses do not explain this baseline. The
reconciler only schedules due rows, and all observed cron executions read zero
bytes because the retry schedules keep `nextAttemptAt` in the future. Persistent
self-scheduled failures explain the ongoing development load. The current error,
queue history, and configuration establish the current cause; historical logs do
not retain an error classification for every individual September attempt.

The retry formula also capped its exponent at 8, so its effective maximum delay
was `60_000 × 256 = 15_360_000 ms` (4 h 16 min), despite an outer six-hour cap.
Observed schedule intervals match that effective maximum.

### How to reproduce the live inspection

Use `--deployment walter-benavides:bolsillo:dev` and repeat with `:prod`:

```sh
npx convex data r2DeletionJobs --format json --limit 1000 --deployment walter-benavides:bolsillo:dev
npx convex data _scheduled_functions --format json --limit 1000 --deployment walter-benavides:bolsillo:dev
npx convex data fileUploadBatches --format json --limit 1000 --deployment walter-benavides:bolsillo:dev
npx convex data transactionFiles --format json --limit 1000 --deployment walter-benavides:bolsillo:dev
npx convex env list --names-only --deployment walter-benavides:bolsillo:dev
npx convex logs --history 1000 --success --jsonl --deployment walter-benavides:bolsillo:dev
```

The log command streams after returning history; stop it after capture. These
commands read data and do not deploy code or execute cleanup. Inspect object keys
privately when matching references; do not publish credentials or raw records.
The snapshots here were below the 1,000-document limit.

The [team usage dashboard](https://dashboard.convex.dev/t/walter-benavides/settings/usage)
uses `GET /api/dashboard/teams/391537/usage/query` on `api.convex.dev`, with query
ID `76c86baa-418e-4d7f-ac21-46f397030595`, project ID `2612394`, and `from`/`to`
dates. Authentication and an Origin header are required. The dashboard's
[usage metric parser](https://github.com/get-convex/convex-backend/blob/main/npm-packages/dashboard/src/hooks/usageMetrics.ts)
converts Node compute from GB-seconds to GB-hours by dividing by 3,600. Raw API
responses, credentials, object keys, and user identifiers are not included here.

## Change

- Route new deletion work, retries, and reconciliation through
  `transactionFiles:dispatchDeletionJobs`, an internal mutation. If configuration
  is missing, emit `r2.cleanup.deferred` with missing variable **names** and keep
  the jobs intact. No repeated Node action or per-job failure increment is needed
  to check unchanged configuration. The existing hourly cron remains enabled in
  both environments and discovers the work after configuration is restored.
- Respect each job's `nextAttemptAt`, deduplicate IDs, and schedule at most 50
  objects per action. Track the scheduled action ID transactionally so overlapping
  dispatch/reconciliation calls do not schedule another active action. Canceled,
  failed, or missing schedules can be recovered by reconciliation.
- Check the indexed object key against file metadata before dispatch and again
  when the action reads its jobs. Pending and ready attachments are protected.
  A referenced job remains visible with `FILE_STILL_REFERENCED` and a six-hour
  deferral; removing the reference allows a later retry.
- Preserve transient and permanent R2 failures, group retries by their own
  deadlines, and allow backoff to reach its intended six-hour maximum. There is
  no attempt limit or dead-letter discard. Configuration preflight only checks
  presence; malformed credentials/endpoints still produce visible retryable
  action failures.
- Record logical job attempts, retries, acknowledgments, failures, SDK attempts,
  R2 request duration, and handler duration in `r2.cleanup.completed`. No object
  keys or file names are logged. Per-object R2 errors with empty messages remain
  failures rather than falling out of both result lists.

These changes apply equally to production and development. They do not disable
orphan cleanup. Existing expired-batch cleanup still transfers failed deletions
to the durable queue. Existing legacy action schedules remain callable and may
run once after rollout; subsequent retries use the dispatcher. No historical job
rows need deletion or a data migration.

The observed cause does not justify changing R2 transport timeouts or adding a
production/development switch. Duplicate scheduling and mixed-deadline retries
were code-level risks, not measured causes of the September concentration.

## Comparable before/after workload

Run:

```sh
npm ci
npm run test:cleanup:compare
# Optional alternative baseline commit:
npm run test:cleanup:compare -- 7641bfd
```

The runner exports the original commit into a temporary directory, shares the
installed dependency versions, and executes the same `convex-test` replay against
that code and the current working tree. It never contacts a deployment. The
workload seeds two groups of two aborted-upload objects with 103 prior attempts,
unconfigured R2, and 24 hourly reconciliations over 24 simulated hours. It uses
the real queue producers, scheduler, mutations, and action handler. AWS requests
are intercepted and fail the test if unexpectedly attempted.

Representative run on Node 22.23.2:

| Metric, same 24-hour workload | Original `7641bfd` | Changed code |
| --- | ---: | ---: |
| Node action starts | 12 | 0 |
| Job attempts, all retries | 24 | 0 |
| Useful deletions | 0 | 0 |
| R2 requests / external R2 duration | 0 / 0 ms | 0 / 0 ms |
| Remaining durable jobs | 4 | 4 |
| Pending self-scheduled work at end | 2 | 0 |
| Measured local action handler time | 14.075 ms | 0 ms |
| Local duration × 0.5 GiB / 3,600,000 | 0.000001955 GB-hours | 0 GB-hours |

The action count and retry reduction are reproducible; local timings vary.
**The duration-derived local number is not measured hosted billing.**
`convex-test` has no remote RPC, Node cold start, or hosted compute meter. The
separate live log baseline above records actual hosted execution before the
change. At that sample's mean duration, 12 avoided action starts correspond to
approximately 0.003289 GB-hours/day; this is an estimate, not a post-deployment
usage measurement. Mutation work still exists, and is not included in the action
compute comparison. The missing-configuration path schedules one small dispatcher
per nonempty reconciliation rather than continually attempting deletion.

## Validation and rollout follow-up

Regression tests cover empty and missing jobs, unconfigured queues, configuration
recovery, local storage, legacy schedules, expired orphan uploads, committed
attachments, batches over 50, repeated/overlapping dispatch, canceled-action
recovery, due-time enforcement, transient failures, permanent failures, mixed
retry deadlines, partial R2 errors, and pending/ready file-reference protection.
Recovery tests use mocked successful R2 acknowledgments. They do not delete live
objects. A successful R2 deletion acknowledgment can also mean an object was
already absent; telemetry counts acknowledgments, not confirmed physical removals.

Implementation and controlled measurement are complete locally. **No cloud code,
R2 configuration, or stored objects were changed during this investigation.** A
hosted after-period remains to be measured after rollout:

1. Deploy through the normal release process. Keep the four development jobs.
   The two already-scheduled legacy actions may each run once before their next
   dispatcher defers them.
2. Compare another complete 24-hour interval with the same missing configuration
   and queue depth. Expect zero recurring `processDeletionJobs` actions, four
   retained jobs, and hourly deferral diagnostics. Compare both Node action and
   mutation compute in the dashboard; account for the legacy transition window.
3. When the intended development bucket and credentials are available, configure
   them normally. The next hourly reconciliation should resume due work. Confirm
   `attempted`, `retries`, `succeeded`, `failed`, `r2DurationMs`, queue depth, and
   actual per-function compute separately for development and production.
4. Compare configured production workloads by eligible object count and failure
   rate. Use action completion logs for full hosted duration/compute and the new
   telemetry for the R2 portion. Handler `durationMs` excludes platform startup.
