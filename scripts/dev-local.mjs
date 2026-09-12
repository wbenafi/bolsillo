import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { bucket, convex, convexCli, localEnvironment, storage } from "./local-config.mjs";

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // Each service has its own process group, including Next/Convex subprocesses.
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
  }
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

function start(command, args, env = {}, piped = false) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    detached: true,
    stdio: piped ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  children.push(child);
  child.on("error", (error) => { console.error(error.message); stop(1); });
  child.on("exit", (code) => { if (!stopping) stop(code || 1); });
  return child;
}

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`El puerto ${port} está ocupado. Detené el servicio anterior antes de iniciar dev:local.`)));
    server.listen(port, () => server.close(resolve));
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* Service is still starting. */ }
    await delay(500);
  }
  throw new Error(`El servicio no respondió: ${url}`);
}

async function installMinio() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("El instalador local de MinIO está preparado para Linux x64.");
  }
  const binary = ".local/bin/minio";
  const checksum = "7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f";
  let bytes = await readFile(binary).catch(() => null);
  if (!bytes) {
    console.log("Descargando MinIO para testing local (AGPLv3, release 2025-09-07)…");
    const response = await fetch("https://dl.min.io/server/minio/release/linux-amd64/minio.RELEASE.2025-09-07T16-13-09Z", { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`No se pudo descargar MinIO: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Checksum de MinIO inválido.");
    await writeFile(`${binary}.download`, bytes);
    await rename(`${binary}.download`, binary);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Checksum del binario local de MinIO inválido.");
  await chmod(binary, 0o755);
  return binary;
}

try {
  const env = localEnvironment();
  if (!env.CLERK_JWT_ISSUER_DOMAIN) throw new Error("Falta CLERK_JWT_ISSUER_DOMAIN en .env.local.");
  for (const port of [3000, 9000, 9001, Number(new URL(env.NEXT_PUBLIC_CONVEX_URL).port)]) await freePort(port);
  await mkdir(".local/bin", { recursive: true });
  await mkdir(".local/minio", { recursive: true });
  const binary = await installMinio();
  start(binary, ["server", ".local/minio", "--address", "127.0.0.1:9000", "--console-address", "127.0.0.1:9001"], {
    MINIO_ROOT_USER: storage.credentials.accessKeyId,
    MINIO_ROOT_PASSWORD: storage.credentials.secretAccessKey,
    MINIO_API_CORS_ALLOW_ORIGIN: "http://localhost:3000,http://127.0.0.1:3000",
    MINIO_BROWSER_REDIRECT_URL: "http://127.0.0.1:9001",
  });
  await waitFor(`${storage.endpoint}/minio/health/live`);
  const client = new S3Client(storage);
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } finally { client.destroy(); }
  console.log(`Bucket privado listo: ${bucket}`);

  let ready = false;
  const backend = start(process.execPath, [convexCli, "dev", "--tail-logs", "disable"], {}, true);
  for (const stream of [backend.stdout, backend.stderr]) {
    stream.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes("Convex functions ready")) ready = true;
    });
  }
  await waitFor(`${env.NEXT_PUBLIC_CONVEX_URL}/version`);
  const variables = {
    CLERK_JWT_ISSUER_DOMAIN: env.CLERK_JWT_ISSUER_DOMAIN,
    R2_LOCAL_ENDPOINT: storage.endpoint,
    R2_BUCKET_NAME: bucket,
    R2_ACCESS_KEY_ID: storage.credentials.accessKeyId,
    R2_SECRET_ACCESS_KEY: storage.credentials.secretAccessKey,
    R2_PRESIGN_TTL_SECONDS: "300",
  };
  await writeFile(".local/convex.env", Object.entries(variables).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  convex(["env", "set", "--from-file", ".local/convex.env"]);
  for (let attempt = 0; !ready && !stopping && attempt < 180; attempt++) await delay(500);
  if (!ready || stopping) throw new Error("Convex no terminó de compilar; revisá los mensajes anteriores.");
  start(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3000"]);
  console.log("App: http://localhost:3000 · MinIO: http://127.0.0.1:9001 · Ctrl+C detiene los tres servicios.");
} catch (error) {
  console.error(error.message);
  stop(1);
}
