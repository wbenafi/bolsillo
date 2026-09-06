import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";

export const storage = {
  endpoint: "http://127.0.0.1:9000",
  region: "auto",
  forcePathStyle: true,
  credentials: { accessKeyId: "bolsillo-local", secretAccessKey: "bolsillo-local-testing-only" },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
};
export const bucket = "bolsillo-files-local";
export const convexCli = "node_modules/convex/bin/main.js";

export function localEnvironment() {
  const env = { ...parseEnv(readFileSync(".env.local", "utf8")), ...process.env };
  if (
    !env.CONVEX_DEPLOYMENT?.startsWith("local:") ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.NEXT_PUBLIC_CONVEX_URL ?? "") ||
    env.CONVEX_DEPLOY_KEY || env.CONVEX_SELF_HOSTED_URL || env.CONVEX_SELF_HOSTED_ADMIN_KEY
  ) {
    throw new Error("Seleccioná Convex local primero: npx convex deployment select local (o create local --select si aún no existe). Quitá overrides de deploy del shell.");
  }
  return env;
}

export function convex(args) {
  localEnvironment();
  return execFileSync(process.execPath, [convexCli, ...args, "--deployment", "local"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

export function runAs(identity, name, args = {}) {
  const result = convex(["run", name, JSON.stringify(args), "--identity", JSON.stringify(identity)]);
  return result ? JSON.parse(result) : undefined;
}

export function enableLocalIdentity(identity) {
  const previous = convex(["env", "get", "SUPERADMIN_CLERK_USER_IDS"]);
  const ids = [...new Set([...previous.split(",").filter(Boolean), identity.subject])];
  convex(["env", "set", "SUPERADMIN_CLERK_USER_IDS", ids.join(",")]);
  try {
    const account = runAs(identity, "users:ensureCurrent");
    runAs(identity, "superadmin:setFeatureOverride", {
      accountId: account.accountId,
      featureKey: "transactions.files",
      enabled: true,
    });
    return account;
  } finally {
    if (previous) convex(["env", "set", "SUPERADMIN_CLERK_USER_IDS", previous]);
    else convex(["env", "remove", "SUPERADMIN_CLERK_USER_IDS"]);
  }
}
