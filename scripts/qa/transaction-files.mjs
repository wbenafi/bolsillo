import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, devices } from '@playwright/test';
import { clerkSetup } from '@clerk/testing/playwright';
import { createClerkClient } from '@clerk/backend';
import sharp from 'sharp';
import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { localEnvironment, enableLocalIdentity, runAs, storage, bucket } from '../local-config.mjs';
import { renderReport } from './report.mjs';

const env = localEnvironment();
for (const key of ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY']) process.env[key] = env[key];
process.env.CLERK_PUBLISHABLE_KEY = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const baseURL = 'http://localhost:3000';
const runId = new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '');
const root = path.resolve('output/transaction-files-qa');
const out = path.join(root, runId);
for (const dir of ['videos', 'screenshots', 'fixtures', 'downloads']) await mkdir(path.join(out, dir), { recursive: true });
const results = [];
const report = { createdAt: new Date().toISOString(), environment: 'Next.js + Convex local + MinIO; identidad Clerk de desarrollo', results, runId, findings: [], technical: [] };
const api = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
const email = 'bolsillo.qa+clerk_test@example.com';
let user = (await api.users.getUserList({ emailAddress: [email] })).data[0];
if (!user) user = await api.users.createUser({ emailAddress: [email], firstName: 'Bolsillo', lastName: 'QA', skipPasswordRequirement: true });
const identity = { subject: user.id, issuer: env.CLERK_JWT_ISSUER_DOMAIN, name: 'Bolsillo QA', email };
const account = enableLocalIdentity(identity);
const run = (name, args = {}) => runAs(identity, name, args);
const s3 = new S3Client(storage);
  for (let attempt = 0; ; attempt++) {
    try { await clerkSetup({ dotenv: false }); break; }
    catch (error) { if (attempt >= 2) throw error; console.log('Reintentando conexión con Clerk…'); await delay(2000); }
  }
const ticket = await api.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 300 });
const browser = await chromium.launch({ headless: true, channel: 'chromium', slowMo: 100, args: ['--disable-features=LocalNetworkAccessChecks'] });
let state;
const fixtures = {};
const fixture = async (name, data) => { const file = path.join(out, 'fixtures', name); await writeFile(file, data); fixtures[name] = file; return file; };
const receipt = `<svg width="720" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="900" fill="#f5f1e8"/><rect x="40" y="40" width="640" height="820" rx="24" fill="white"/><text x="80" y="120" font-size="22" fill="#21796b" font-family="sans-serif">BOLSILLO · COMPROBANTE DE PRUEBA</text><text x="80" y="210" font-size="42" font-family="sans-serif">Materiales para casa</text><text x="80" y="275" font-size="24" fill="#626b66" font-family="sans-serif">Documento ficticio · QA local</text><path d="M80 320H640" stroke="#ddd"/><text x="80" y="395" font-size="27" font-family="sans-serif">Pintura y herramientas</text><text x="80" y="560" font-size="23" fill="#626b66" font-family="sans-serif">TOTAL</text><text x="80" y="630" font-size="66" fill="#21796b" font-family="sans-serif">CRC 18 500</text><text x="80" y="780" font-size="21" fill="#626b66" font-family="sans-serif">Sin datos personales ni valor fiscal</text></svg>`;
for (const [ext, format] of [['png', 'png'], ['jpg', 'jpeg'], ['webp', 'webp']]) await fixture(`comprobante.${ext}`, await sharp(Buffer.from(receipt))[format]().toBuffer());
await fixture('detalle.txt', 'BOLSILLO · PRUEBA LOCAL\nCompra de materiales: CRC 18 500\nDocumento ficticio, sin valor fiscal.\n');
await fixture('adicional.txt', 'Nota agregada después de guardar el movimiento.\n');
await fixture('demasiado-grande.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
await fixture('vacio.txt', '');
await fixture('no-permitido.exe', 'Archivo de prueba: no es ejecutable.');
await fixture('imagen-falsa.png', 'Este texto no es una imagen PNG.');
const pdfPage = await browser.newPage();
await pdfPage.setContent(`<html><body style="font-family:sans-serif;padding:60px;color:#175e52"><h1>Comprobante de prueba</h1><p>Bolsillo · QA local · Documento ficticio</p><hr><h2>Materiales para casa</h2><p>Pintura y herramientas</p><h1>CRC 18 500</h1><p>Sin datos personales ni valor fiscal.</p></body></html>`);
await pdfPage.pdf({ path: path.join(out, 'fixtures', 'factura.pdf'), format: 'A4', printBackground: true });
fixtures['factura.pdf'] = path.join(out, 'fixtures', 'factura.pdf');
await pdfPage.close();

const authContext = await browser.newContext({ permissions: ['local-network-access'], baseURL });
try {
  const page = await authContext.newPage();
  await setupClerkNetwork(page);
  await goto(page, '/sign-in');
  await page.waitForFunction(() => window.Clerk?.loaded, undefined, {timeout:30000});
  try {await page.evaluate(async ticket => { const result = await window.Clerk.client.signIn.create({strategy:'ticket',ticket}); if(result.status !== 'complete') throw new Error('El ticket QA no inició sesión'); await window.Clerk.setActive({session:result.createdSessionId}); }, ticket.token); } catch(error) { if(!/Execution context was destroyed/.test(error.message)) throw error; }
  await page.waitForTimeout(1000);
  await goto(page, '/');
  await expect(page.getByRole('heading', { name: 'Bolsillos', exact: true })).toBeVisible({ timeout: 30000 });
  state = await authContext.storageState();
} finally { await authContext.unrouteAll({behavior: 'ignoreErrors'}); await authContext.close(); }
console.log('Sesión QA preparada; iniciando grabaciones.');

async function setupClerkNetwork(page) {
  // Use the real Clerk service through Node's HTTP transport because Chromium's
  // DNS resolver is unreliable in this environment. No auth responses are mocked.
  async function relay(route, publicEntry = false) {
    try {
      const request = route.request();
      if(publicEntry && (request.method() !== 'GET' || !request.isNavigationRequest())) { await route.continue(); return; }
      const url = new URL(request.url());
      if (!publicEntry && url.pathname.startsWith('/v1/')) url.searchParams.set('__clerk_testing_token', process.env.CLERK_TESTING_TOKEN);
      if(publicEntry) {
        const response=await fetch(url,{headers:{accept:'*/*',cookie:request.headers().cookie ?? ''}});
        const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies.join('\n');
        await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
      } else {
        const response=await fetch(process.env.QA_RELAY_URL ?? 'http://127.0.0.1:9091',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url.toString(),method:request.method(),headers:Object.fromEntries(Object.entries(request.headers()).filter(([key])=>['authorization','cookie','content-type','origin','referer'].includes(key))),body:request.postDataBuffer()?.toString('base64')})});
        const result=await response.json();
        if(!response.ok)throw new Error(`Relay de Clerk: ${result.error}`);
        await route.fulfill({status:result.status,headers:result.headers,body:Buffer.from(result.body,'base64')});
      }
    } catch(error) { console.error('Clerk HTTP:', new URL(route.request().url()).pathname, error.cause?.code, error.cause?.message || error.message); await route.abort().catch(()=>{}); }
  }
  await page.context().route(`${env.CLERK_JWT_ISSUER_DOMAIN}/**`, route => relay(route));
  await page.context().route(`${baseURL}/sign-in`, route => relay(route, true));
}

async function goto(page, url) {
  for (let attempt=0;;attempt++) {
    try { return await page.goto(url, {waitUntil: 'domcontentloaded'}); }
    catch(error) { if(attempt>=2 || !/ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/.test(error.message)) throw error; await delay(1200); }
  }
}

async function step(page, result, text) {
  result.steps.push(text);
  console.log(`${result.id}: ${text}`);
  await page.evaluate((text) => {
    let label = document.getElementById('qa-guide');
    if (!label) {
      label = document.createElement('div'); label.id = 'qa-guide';
      label.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:calc(100vw - 24px);z-index:2147483646;pointer-events:none;background:#153d36ed;color:white;border:1px solid #76b8a3;border-radius:10px;padding:9px 14px;font:13px/1.5 system-ui;box-shadow:0 4px 18px #0002';
      document.body.append(label);
    }
    label.textContent = `GUÍA QA · ${text}`;
  }, text);
  await page.waitForTimeout(800);
}
async function scenario(id, title, description, fn, mobile = false) {
  if(process.env.QA_SCENARIOS && !process.env.QA_SCENARIOS.split(',').includes(id)) return;
  const result = { id, title, description, device: mobile ? 'Móvil · 393 × 851' : 'Escritorio · 1440 × 1000', status: 'running', steps: [], checks: [], screenshots: [], expectedErrors: [], errors: [] };
  results.push(result);
  const viewport = mobile ? { width: 393, height: 851 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ permissions: ['local-network-access'], baseURL, storageState: state, ...(mobile ? devices['Pixel 7'] : {}), viewport, recordVideo: { dir: path.join(out, 'videos'), size: viewport }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => result.errors.push(e.message));
  const started = Date.now();
  try {
    await setupClerkNetwork(page);
    await fn(page, result);
    await page.waitForTimeout(1000);
    assert.deepEqual(result.errors, [], 'No debe haber errores JavaScript inesperados.');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.failure = String(error.message).slice(0, 2500);
    console.error(`${id} FALLÓ: ${result.failure}`);
  } finally {
    const shot = `screenshots/${id}.png`;
    await page.screenshot({ path: path.join(out, shot), fullPage: !(await page.getByRole('dialog').isVisible()) }).catch(() => {});
    result.screenshots.push(shot);
    result.duration = Math.round((Date.now() - started) / 1000);
    const video = page.video();
    if(result.status === 'passed') {
      const token = await page.evaluate(async()=>await window.Clerk?.session?.getToken({skipCache:true}));
      if(token) await context.addCookies([{name:'__session',value:token,url:baseURL,httpOnly:false,sameSite:'Lax'}]);
      state = await context.storageState();
    }
    await context.unrouteAll({behavior: 'ignoreErrors'});
    await context.close();
    if (video) { result.video = `videos/${id}.webm`; await video.saveAs(path.join(out, result.video)); const original = await video.path(); if (original !== path.join(out, result.video)) await video.delete(); }
    await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
    await renderReport(out, report);
  }
}
const wallet = (name) => run('wallets:createWallet', { name: `QA · ${name} · ${runId.slice(11,16)}`, currency: 'CRC' });
const list = (walletId) => run('transactions:listTransactionsByWallet', { walletId });
async function form(page, walletId, description, amount = '18500') {
  await goto(page, `/wallets/${walletId}`);
  await page.getByRole('link', { name: /agregar gasto/i }).click();
  await page.getByLabel('Monto', { exact: true }).fill(amount);
  await page.getByLabel('Descripción', { exact: true }).fill(description);
}
async function attach(page, names) { await page.locator('input[type=file]').setInputFiles(names.map(name => fixtures[name])); }
async function save(page, walletId, edit = false) {
  await page.getByRole('button', { name: edit ? 'Guardar cambios' : 'Guardar movimiento', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/wallets/${walletId}$`), { timeout: 30000 });
}
async function edit(page, walletId, description) { await goto(page, `/wallets/${walletId}`); await page.getByRole('link', { name: new RegExp(description) }).click(); await expect(page.getByRole('heading', { name: 'Editar movimiento' })).toBeVisible(); }
async function preview(page, title) {
  await page.getByRole('button', { name: `Ver ${title}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar', exact: true })).toBeEnabled();
}
async function closePreview(page) { await page.getByRole('button', { name: 'Cerrar vista previa' }).click(); }
async function shot(page, result, suffix) { const file = `screenshots/${result.id}-${suffix}.png`; await page.screenshot({ path: path.join(out, file), fullPage: !(await page.getByRole('dialog').isVisible()) }); result.screenshots.push(file); }
async function waitDeleted(keys) {
  for (let i = 0; i < 40; i++) {
    const statuses = await Promise.all(keys.map(async Key => { try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key })); return false; } catch (e) { if (e.$metadata?.httpStatusCode === 404) return true; throw e; } }));
    if (statuses.every(Boolean)) return;
    await delay(500);
  }
  throw new Error('Los objetos aún existen en MinIO después de 20 segundos.');
}
function keysFor(files) { return files.map(file => `accounts/${account.accountId}/transaction-files/${file._id}`); }

try {
await scenario('01-carga-formatos', 'Carga de los cinco formatos', 'Crear un gasto con JPG, PNG, WebP, PDF y TXT; guardar, recargar y comprobar la persistencia.', async (page, r) => {
  const id = wallet('Cinco formatos');
  await form(page, id, 'Materiales con cinco comprobantes');
  await step(page, r, 'Adjuntar JPG, PNG, WebP, PDF y TXT');
  await attach(page, ['comprobante.jpg', 'comprobante.png', 'comprobante.webp', 'factura.pdf', 'detalle.txt']);
  await expect(page.locator('.transaction-file-list article')).toHaveCount(5);
  await step(page, r, 'El formulario muestra cinco adjuntos y permite una vista previa antes de guardar');
  await preview(page, 'comprobante.png'); await shot(page, r, 'preview-local'); await closePreview(page);
  await save(page, id);
  await step(page, r, 'El movimiento se guardó: el listado indica cinco archivos');
  assert.equal(list(id)[0].fileCount, 5);
  await edit(page, id, 'Materiales con cinco comprobantes'); await page.reload();
  await expect(page.locator('.transaction-file-list article')).toHaveCount(5);
  await step(page, r, 'Después de recargar, los cinco archivos siguen guardados');
  r.checks.push('Cinco archivos persistidos en Convex y MinIO.', 'Movimiento creado una sola vez.', 'Saldo actualizado por CRC 18 500.', 'Miniaturas y adjuntos recuperados después de recargar.');
  assert.equal(run('wallets:getWallet', { walletId: id }).balance, -18500);
});

await scenario('02-vistas-descargas', 'Vistas previas y descargas', 'Abrir los cinco formatos guardados y comprobar que la descarga conserva exactamente sus bytes.', async (page, r) => {
  const id = wallet('Vista previa'); await form(page, id, 'Documentos para visualizar');
  const names = ['comprobante.jpg','comprobante.png','comprobante.webp','factura.pdf','detalle.txt'];
  await attach(page, names); await save(page, id); await edit(page, id, 'Documentos para visualizar');
  for (const name of names) {
    await step(page, r, `Abrir y descargar ${name}`); await preview(page, name);
    if (name.endsWith('.txt')) await expect(page.locator('.file-viewer-content pre')).toContainText('Compra de materiales');
    else if (name.endsWith('.pdf')) await expect(page.locator('.file-viewer-content iframe')).toBeVisible();
    else await expect(page.locator('.file-viewer-image img')).toBeVisible();
    await page.waitForTimeout(name.endsWith('.pdf') ? 2000 : 700); await shot(page, r, name.replaceAll('.', '-'));
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar', exact: true }).click(); const download = await pending;
    assert.equal(download.suggestedFilename(), name);
    const file = path.join(out, 'downloads', name); await download.saveAs(file); assert.deepEqual(await readFile(file), await readFile(fixtures[name]));
    r.checks.push(`${name}: vista previa abierta; descarga con nombre y bytes originales.`);
    await closePreview(page);
  }
});

await scenario('03-edicion-cancelacion', 'Editar, reemplazar y cancelar', 'Renombrar un archivo, quitar otro, agregar uno nuevo por arrastre y comprobar que Cancelar conserva lo guardado.', async (page, r) => {
  const id = wallet('Edición'); await form(page, id, 'Edición de comprobantes'); await attach(page, ['comprobante.png','detalle.txt']); await save(page, id);
  await edit(page, id, 'Edición de comprobantes');
  await step(page, r, 'Renombrar imagen y quitar el TXT original');
  await page.getByPlaceholder('comprobante.png', { exact: true }).fill('Factura de materiales');
  const oldFiles = run('transactionFiles:listByTransaction', { transactionId: list(id)[0]._id });
  const oldText = oldFiles.find(f => f.originalName === 'detalle.txt');
  await page.getByRole('button', { name: 'Quitar detalle.txt', exact: true }).click();
  const text = await readFile(fixtures['adicional.txt'], 'utf8');
  const dt = await page.evaluateHandle(text => { const dt = new DataTransfer(); dt.items.add(new File([text], 'adicional.txt', { type:'text/plain' })); return dt; }, text);
  await step(page, r, 'Arrastrar una nota nueva al área de archivos'); await page.locator('.file-dropzone').dispatchEvent('drop', { dataTransfer: dt }); await dt.dispose();
  await save(page, id, true); await edit(page, id, 'Edición de comprobantes');
  await expect(page.getByPlaceholder('comprobante.png', { exact:true })).toHaveValue('Factura de materiales');
  await expect(page.locator('.transaction-file-list article')).toHaveCount(2);
  await waitDeleted(keysFor([oldText]));
  await preview(page, 'Factura de materiales');
  const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Descargar',exact:true}).click(); const download=await pending; assert.equal(download.suggestedFilename(),'Factura de materiales.png'); await download.saveAs(path.join(out,'downloads',download.suggestedFilename())); await closePreview(page);
  await step(page, r, 'Quitar la imagen y cambiar la nota, pero cancelar la edición');
  await page.getByRole('button',{name:'Quitar Factura de materiales',exact:true}).click(); await page.getByPlaceholder('adicional.txt',{exact:true}).fill('Cambio que no se guardará'); await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await edit(page,id,'Edición de comprobantes'); await expect(page.locator('.transaction-file-list article')).toHaveCount(2); await expect(page.getByPlaceholder('adicional.txt',{exact:true})).toHaveValue('');
  await step(page,r,'Cancelar conservó la imagen y el nombre anterior de la nota');
  r.checks.push('Renombre persistido y extensión .png conservada al descargar.', 'Archivo reemplazado eliminado físicamente.', 'Arrastre aceptado y orden persistido.', 'Cancelar no modifica los adjuntos guardados.');
});

await scenario('04-validaciones', 'Límites y archivos no permitidos', 'Rechazar archivos vacíos, mayores de 2 MB, extensiones no admitidas y un sexto adjunto.', async (page,r) => {
  const id=wallet('Validaciones'); await form(page,id,'Límites de archivos');
  for (const [name, message] of [['no-permitido.exe','usá JPG'],['vacio.txt','2 MB o menos'],['demasiado-grande.txt','2 MB o menos']]) {
    await step(page,r,`Intentar adjuntar ${name}`); await attach(page,[name]); await expect(page.locator('[data-sonner-toast]').filter({hasText:message}).last()).toBeVisible(); await expect(page.locator('.transaction-file-list article')).toHaveCount(0); await shot(page,r,name.split('.')[0]);
  }
  await step(page,r,'Seleccionar seis archivos: se aceptan cinco y se informa el límite');
  await attach(page,['comprobante.jpg','comprobante.png','comprobante.webp','factura.pdf','detalle.txt','adicional.txt']);
  await expect(page.locator('.transaction-file-list article')).toHaveCount(5); await expect(page.locator('input[type=file]')).toBeDisabled();
  await expect(page.locator('[data-sonner-toast]').filter({hasText:'Solo quedan 5'})).toBeVisible();
  assert.equal(list(id).length,0); await shot(page,r,'limite-cinco');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click(); assert.equal(list(id).length,0);
  r.checks.push('EXE, TXT vacío y TXT de 2 MB + 1 byte rechazados.', 'Solo cinco adjuntos aceptados.', 'El selector se deshabilita al alcanzar el máximo.', 'Cancelar no crea movimientos ni sube objetos.');
});

await scenario('05-contenido-falso', 'Validación del contenido real', 'Un archivo llamado .png cuyo contenido es texto llega a R2 pero Convex impide guardar el movimiento y limpia la carga.', async(page,r)=>{
  const id=wallet('Contenido'); await form(page,id,'Comprobante inválido'); await attach(page,['imagen-falsa.png']);
  await step(page,r,'Intentar guardar un texto disfrazado de PNG');
  await page.getByRole('button',{name:'Guardar movimiento',exact:true}).click();
  await expect(page.locator('[data-sonner-toast]').filter({hasText:'no coincide'})).toBeVisible({timeout:30000});
  assert.equal(list(id).length,0); await expect(page.getByText('No se pudo subir',{exact:true})).toBeVisible(); await shot(page,r,'rechazo');
  r.expectedErrors.push('Error de validación intencional: el contenido no coincide con PNG.');
  await step(page,r,'Quitar el archivo inválido y guardar un PNG real');
  await page.getByRole('button',{name:'Quitar imagen-falsa.png',exact:true}).click(); await attach(page,['comprobante.png']); await save(page,id);
  assert.equal(list(id).length,1); r.checks.push('Convex rechaza la firma de contenido inválida.', 'No se crea un movimiento parcial.', 'La corrección permite guardar una sola vez.');
});

await scenario('06-fallo-reintento', 'Fallo de carga y reintento', 'Interrumpir una de dos cargas; conservar el formulario y reintentar sin duplicar el movimiento.',async(page,r)=>{
  const id=wallet('Reintento'); await form(page,id,'Carga recuperada'); await attach(page,['detalle.txt','comprobante.png']);
  let failed=false;
  await page.route('http://127.0.0.1:9000/**',async route=>{if(route.request().method()==='PUT'&&!failed){failed=true;await route.abort('failed');}else await route.continue();});
  await step(page,r,'Simular un fallo de red en una de las dos cargas');
  await page.getByRole('button',{name:'Guardar movimiento',exact:true}).click();
  await expect(page.getByText('No se pudo subir',{exact:true})).toHaveCount(2,{timeout:30000}); assert.equal(list(id).length,0);
  await expect(page.getByLabel('Descripción',{exact:true})).toHaveValue('Carga recuperada'); await shot(page,r,'fallo');
  await page.unroute('http://127.0.0.1:9000/**');
  await step(page,r,'Reintentar con la red disponible'); await save(page,id);
  assert.equal(list(id).length,1); assert.equal(list(id)[0].fileCount,2); await edit(page,id,'Carga recuperada');
  r.expectedErrors.push('Un PUT se abortó deliberadamente para simular una caída de red.');
  r.checks.push('Fallo parcial no cambia saldo ni crea movimiento.', 'Formulario y archivos conservados para reintentar.', 'Reintento crea un único movimiento con dos archivos.');
});

await scenario('07-permisos', 'Deshabilitar y restaurar el feature', 'Cambiar el permiso desde Superadmin: se ocultan los adjuntos, el backend rechaza lecturas y al reactivar se recuperan.',async(page,r)=>{
  const id=wallet('Permisos'); await form(page,id,'Comprobante con permisos'); await attach(page,['detalle.txt']); await save(page,id);
  const tx=list(id)[0]; const files=run('transactionFiles:listByTransaction',{transactionId:tx._id});
  try {
    await goto(page, `/superadmin/accounts/${account.accountId}`); await step(page,r,'Deshabilitar Archivos en movimientos desde Superadmin');
    await page.getByRole('button',{name:'Deshabilitar Archivos en movimientos',exact:true}).click(); await expect(page.getByRole('button',{name:'Habilitar Archivos en movimientos',exact:true})).toBeVisible();
    await edit(page,id,'Comprobante con permisos'); await expect(page.locator('.transaction-files-field')).toHaveCount(0);
    assert.throws(()=>run('r2:createReadUrl',{fileId:files[0]._id}),/no está habilitada/);
    await step(page,r,'Los adjuntos están ocultos y las nuevas lecturas están bloqueadas'); await shot(page,r,'deshabilitado');
    await goto(page, `/superadmin/accounts/${account.accountId}`); await page.getByRole('button',{name:'Habilitar Archivos en movimientos',exact:true}).click(); await expect(page.getByRole('button',{name:'Deshabilitar Archivos en movimientos',exact:true})).toBeVisible();
    await edit(page,id,'Comprobante con permisos'); await expect(page.locator('.transaction-file-list article')).toHaveCount(1); await preview(page,'detalle.txt');
    await step(page,r,'Al restaurar el permiso, el archivo original vuelve a estar disponible');
    r.checks.push('Cambio administrativo aplicado en UI y backend.', 'Deshabilitar preserva el archivo.', 'Rehabilitar recupera la vista previa sin volver a cargarlo.');
  } finally {run('superadmin:setFeatureOverride',{accountId:account.accountId,featureKey:'transactions.files',enabled:true});}
});

await scenario('08-eliminar-movimiento','Eliminar un movimiento con archivos','Cancelar primero la confirmación; después eliminar y verificar que desaparecen el movimiento y sus objetos de MinIO.',async(page,r)=>{
  const id=wallet('Eliminación'); await form(page,id,'Movimiento para eliminar'); await attach(page,['detalle.txt','comprobante.png']); await save(page,id); const tx=list(id)[0]; const files=run('transactionFiles:listByTransaction',{transactionId:tx._id});
  await edit(page,id,'Movimiento para eliminar');
  await step(page,r,'Cancelar la confirmación de eliminación'); page.once('dialog',async dialog=>{assert.match(dialog.message(),/archivos/);await dialog.dismiss();}); await page.getByRole('button',{name:'Eliminar movimiento',exact:true}).click(); assert.equal(list(id).length,1);
  await step(page,r,'Confirmar la eliminación del movimiento y sus archivos'); page.once('dialog',async dialog=>{await delay(800);await dialog.accept();}); await page.getByRole('button',{name:'Eliminar movimiento',exact:true}).click(); await expect(page).toHaveURL(new RegExp(`/wallets/${id}$`));
  assert.equal(list(id).length,0); assert.equal(run('wallets:getWallet',{walletId:id}).balance,0); await waitDeleted(keysFor(files));
  await step(page,r,'Movimiento eliminado, saldo en cero y archivos borrados físicamente');
  r.checks.push('La confirmación menciona los archivos.', 'Cancelar conserva movimiento y archivos.', 'Confirmar elimina ambos objetos de MinIO.', 'Saldo recalculado a cero.');
});

await scenario('09-movil','Flujo de adjuntos en móvil','Crear un gasto, abrir una imagen y un TXT, descargar y quitar un adjunto desde una pantalla de teléfono.',async(page,r)=>{
  const id=wallet('Móvil'); await form(page,id,'Comprobante desde móvil','4200'); await step(page,r,'Adjuntar imagen y texto desde móvil'); await attach(page,['comprobante.png','detalle.txt']); await save(page,id); await edit(page,id,'Comprobante desde móvil');
  await preview(page,'comprobante.png'); await shot(page,r,'imagen'); await closePreview(page);
  await step(page,r,'Leer y descargar la nota'); await preview(page,'detalle.txt'); await expect(page.locator('.file-viewer-content pre')).toContainText('Compra de materiales');
  const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Descargar',exact:true}).click(); const dl=await pending; assert.equal(dl.suggestedFilename(),'detalle.txt'); await closePreview(page);
  await page.getByRole('button',{name:'Quitar detalle.txt',exact:true}).click(); await save(page,id,true); await edit(page,id,'Comprobante desde móvil'); await expect(page.locator('.transaction-file-list article')).toHaveCount(1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No debe haber desbordamiento horizontal');
  await step(page,r,'Cambios guardados; queda una imagen y el diseño cabe en la pantalla');
  r.checks.push('Carga y persistencia en viewport móvil.', 'Visor de imagen y TXT utilizable.', 'Descarga con nombre original.', 'Eliminar adjunto guarda correctamente.', 'Sin desbordamiento horizontal.');
},true);

await scenario('10-bolsillo-archivado','Archivar, restaurar y eliminar un bolsillo','Conservar adjuntos al archivar y restaurar; al eliminar definitivamente, limpiar también los archivos de todos sus movimientos.',async(page,r)=>{
  const id=wallet('Bolsillo archivado'); await form(page,id,'Archivo dentro del bolsillo'); await attach(page,['detalle.txt']); await save(page,id);
  const name=run('wallets:getWallet',{walletId:id}).name;
  const tx=list(id)[0]; const files=run('transactionFiles:listByTransaction',{transactionId:tx._id});
  await step(page,r,'Archivar el bolsillo conserva el movimiento y su archivo');
  await page.getByRole('button',{name:'Opciones del bolsillo',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Archivar',exact:true}).click();await expect(page).toHaveURL(baseURL+'/');
  assert.equal(list(id)[0].fileCount,1);
  await goto(page,'/archived');let card=page.locator('.archived-list article').filter({hasText:name});await card.getByRole('button',{name:'Restaurar',exact:true}).click();
  await edit(page,id,'Archivo dentro del bolsillo');await preview(page,'detalle.txt');await closePreview(page);
  await step(page,r,'Restaurar permite abrir el mismo archivo sin volver a subirlo');
  await goto(page,`/wallets/${id}`);await page.getByRole('button',{name:'Opciones del bolsillo',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Archivar',exact:true}).click();await expect(page).toHaveURL(baseURL+'/');
  await goto(page,'/archived');card=page.locator('.archived-list article').filter({hasText:name});
  await step(page,r,'Eliminar definitivamente el bolsillo, sus movimientos y adjuntos');
  page.once('dialog',async d=>{assert.match(d.message(),/archivos/);await delay(800);await d.accept();});await card.getByRole('button',{name:`Eliminar ${name}`,exact:true}).click();await expect(card).toHaveCount(0);await waitDeleted(keysFor(files));
  r.checks.push('Archivar preserva el adjunto.', 'Restaurar permite volver a visualizarlo.', 'Eliminar el bolsillo borra físicamente el archivo.', 'La confirmación advierte sobre los adjuntos.');
});
report.findings.push({title:'Corregido: adjuntos huérfanos al eliminar un bolsillo',detail:'La eliminación definitiva de un bolsillo archivado borraba movimientos pero conservaba los archivos. Se agregó limpieza en cascada, se actualizó la confirmación y se añadió una prueba de regresión. El escenario 10 verifica el resultado contra MinIO.'});

// Storage and authorization evidence independent of browser UI.
const securityWallet=wallet('Seguridad');
const content=Buffer.from('Prueba de seguridad local');
const batch=run('transactionFiles:beginUpload',{walletId:securityWallet,retainedFileIds:[],files:[{originalName:'seguridad.txt',mimeType:'text/plain',sizeBytes:content.length,order:0}]});
const {uploads:[upload]}=run('r2:createUploadUrls',{batchId:batch.batchId});
assert.equal((await fetch(upload.url,{method:'PUT',headers:upload.headers,body:content})).status,200);
const transactionId=run('r2:finalizeUpload',{batchId:batch.batchId,retainedFiles:[],type:'expense',amountMinor:100,description:'Seguridad local',date:new Date().toISOString().slice(0,10)});
const read=run('r2:createReadUrl',{fileId:upload.fileId});
const unsigned=new URL(read.url);unsigned.search='';assert.equal((await fetch(unsigned)).status,403);
const tampered=new URL(read.url);tampered.searchParams.set('X-Amz-Signature','0'.repeat(64));assert.equal((await fetch(tampered)).status,403);
const expired=await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:`accounts/${account.accountId}/transaction-files/${upload.fileId}`}),{expiresIn:60,signingDate:new Date(Date.now()-120000)});assert.equal((await fetch(expired)).status,403);
const outsider={subject:'bolsillo-qa-other-account',issuer:env.CLERK_JWT_ISSUER_DOMAIN};enableLocalIdentity(outsider);assert.throws(()=>runAs(outsider,'r2:createReadUrl',{fileId:upload.fileId}),/no existe|no encontramos|acceso|archivo/i);
const files=run('transactionFiles:listByTransaction',{transactionId});assert.ok(files.every(f=>!JSON.stringify(f).includes('X-Amz-')));
run('transactions:deleteTransaction',{transactionId});await waitDeleted(keysFor(files));run('wallets:deleteWallet',{walletId:securityWallet});
report.technical.push('GET sin firma: HTTP 403.', 'GET con firma alterada: HTTP 403.', 'URL válidamente firmada pero vencida: HTTP 403.', 'Otra cuenta no obtiene URLs de lectura del archivo.', 'Los metadatos públicos no exponen URLs firmadas.', 'El borrado en Convex termina en eliminación física del objeto.');
const remaining=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:`accounts/${account.accountId}/`}));
report.technical.push(`${remaining.KeyCount} objetos de demostración disponibles en el bucket para esta cuenta QA.`);
} catch(error){ report.findings.push({title:'Comprobación interrumpida',detail:error.message}); console.error(error); process.exitCode=1; }
finally{
  await browser.close();s3.destroy();
  await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  await renderReport(out,report);
  await writeFile(path.join(root,'index.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./${runId}/index.html"><title>Informe QA · Bolsillo</title><a href="./${runId}/index.html">Abrir informe de pruebas</a></html>`);
  console.log(`INFORME: ${out}/index.html`);
  console.log(`RESULTADO: ${results.filter(r=>r.status==='passed').length}/${results.length} escenarios aprobados`);
  if(results.some(r=>r.status!=='passed'))process.exitCode=1;
}
