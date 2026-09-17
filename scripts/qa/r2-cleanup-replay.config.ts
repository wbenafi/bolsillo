import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["scripts/qa/r2-cleanup-replay.test.ts"], environment: "node" },
});
