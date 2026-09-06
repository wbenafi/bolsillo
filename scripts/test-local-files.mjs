import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { enableLocalIdentity, localEnvironment, runAs } from "./local-config.mjs";

const env = localEnvironment();
const identity = { subject: "bolsillo-local-storage-test", issuer: env.CLERK_JWT_ISSUER_DOMAIN, name: "Testing de archivos local" };
const run = (name, args) => runAs(identity, name, args);
enableLocalIdentity(identity);
const walletId = run("wallets:createWallet", { name: "Prueba automática de archivos", currency: "CRC" });
const content = "Comprobante local de Bolsillo\n";
const file = { originalName: "comprobante.txt", mimeType: "text/plain", sizeBytes: Buffer.byteLength(content), order: 0 };
const fields = { type: "expense", amountMinor: 1500, description: "Prueba local R2", date: new Date().toISOString().slice(0, 10) };
let batchId;
let transactionId;
try {
  assert.throws(() => run("transactionFiles:beginUpload", { walletId, retainedFileIds: [], files: [{ ...file, sizeBytes: 2 * 1024 * 1024 + 1 }] }), /2 MB/);
  assert.throws(() => run("transactionFiles:beginUpload", { walletId, retainedFileIds: [], files: Array.from({ length: 6 }, (_, order) => ({ ...file, order })) }), /hasta 5/);
  ({ batchId } = run("transactionFiles:beginUpload", { walletId, retainedFileIds: [], files: [file] }));
  const { uploads: [upload] } = run("r2:createUploadUrls", { batchId });
  assert.equal(new URL(upload.url).hostname, "127.0.0.1");
  const origin = "http://localhost:3000";
  const preflight = await fetch(upload.url, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,if-none-match" },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.ok(preflight.headers.get("access-control-allow-methods")?.includes("PUT"));
  const put = await fetch(upload.url, { method: "PUT", headers: { ...upload.headers, Origin: origin }, body: content });
  assert.equal(put.status, 200);
  const duplicate = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: content });
  assert.equal(duplicate.status, 412, "If-None-Match debe impedir sobrescrituras");
  transactionId = run("r2:finalizeUpload", { batchId, retainedFiles: [], ...fields });
  const files = run("transactionFiles:listByTransaction", { transactionId });
  assert.equal(files.length, 1);
  const read = run("r2:createReadUrl", { fileId: upload.fileId });
  const download = await fetch(read.url);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), content);
  const unsigned = new URL(read.url);
  unsigned.search = "";
  assert.equal((await fetch(unsigned)).status, 403, "El bucket debe permanecer privado");
  const tampered = new URL(read.url);
  tampered.searchParams.set("X-Amz-Signature", "0".repeat(64));
  assert.equal((await fetch(tampered)).status, 403, "La firma debe validarse");
  run("transactionFiles:updateTransactionWithFiles", { transactionId, files: [{ fileId: upload.fileId, displayName: "Factura local", order: 0 }], ...fields });
  assert.equal(run("transactionFiles:listByTransaction", { transactionId })[0].displayName, "Factura local");
  run("transactionFiles:updateTransactionWithFiles", { transactionId, files: [], ...fields });
  assert.equal(run("transactionFiles:listByTransaction", { transactionId }).length, 0);
  let status;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(read.url);
    status = response.status;
    await response.body?.cancel();
    if (status === 404) break;
    await delay(500);
  }
  assert.equal(status, 404, "El job de limpieza debe borrar el objeto de MinIO");
  console.log("OK: límites, CORS, carga firmada, protección de sobrescritura, validación en Convex, descarga, privacidad, firma, renombre y borrado físico.");
} finally {
  if (transactionId) run("transactions:deleteTransaction", { transactionId });
  else if (batchId) run("transactionFiles:abortUpload", { batchId });
  run("wallets:deleteWallet", { walletId });
}
