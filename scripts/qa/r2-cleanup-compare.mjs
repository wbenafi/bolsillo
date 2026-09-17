import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const baseline = process.argv[2] ?? "7641bfd";
const scratch = mkdtempSync(join(tmpdir(), "bolsillo-cleanup-compare-"));
const before = join(scratch, "before");
mkdirSync(before);
// Export without changing the caller's checkout or contacting a deployment.
const archive = join(scratch, "baseline.tar");
execFileSync("git", ["archive", "--format=tar", "--output", archive, baseline], { cwd: root });
execFileSync("tar", ["-xf", archive, "-C", before]);
symlinkSync(join(root, "node_modules"), join(before, "node_modules"), "dir");
for (const name of ["r2-cleanup-replay.test.ts", "r2-cleanup-replay.config.ts"]) {
  copyFileSync(join(root, "scripts/qa", name), join(before, "scripts/qa", name));
}
const results = {};
for (const [label, cwd] of [["before", before], ["after", root]]) {
  const report = join(scratch, `${label}.json`);
  execFileSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "scripts/qa/r2-cleanup-replay.config.ts"], {
    cwd, env: { ...process.env, BOLSILLO_CLEANUP_REPORT: report }, stdio: "inherit",
  });
  results[label] = JSON.parse(readFileSync(report, "utf8"));
}
console.log(JSON.stringify({ baseline, reports: scratch, ...results }, null, 2));
