# Transaction files: preparación de producción

Completá la configuración de R2 y las variables antes de fusionar el PR. El merge
a `main` dispara el flujo de producción existente en Vercel: `vercel.json` ejecuta
`convex deploy` y luego el build de Next.js. La función `transactions.files`
permanece deshabilitada por defecto; habilitala primero para una cuenta de prueba
después del deploy.

## 1. Crear un bucket R2 privado

En la cuenta de Cloudflare que usará producción, activá R2 y creá
`bolsillo-files-prod` (o elegí otro nombre y usalo en todos los pasos). Usá la
jurisdicción predeterminada: el código construye el endpoint S3
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

Podés crearlo desde el dashboard o con Wrangler:

```bash
npx wrangler login
npx wrangler r2 bucket create bolsillo-files-prod
```

Mantené deshabilitados **Public Development URL (r2.dev)** y los dominios públicos
del bucket. El navegador accede mediante URLs firmadas del endpoint S3. No hace
falta un Worker ni un dominio público para archivos.

En R2 → Manage API tokens, creá credenciales con permiso **Object Read & Write**
restringidas al bucket de producción. Guardá el **Access Key ID**, el **Secret
Access Key** y el **Account ID**. El código usa las credenciales S3, no el valor del
token API de Cloudflare. Usá credenciales y un bucket separados para desarrollo.
[Guía oficial de R2/S3](https://developers.cloudflare.com/r2/get-started/s3/).

## 2. Aplicar CORS para el frontend de producción

Copiá `r2/cors.example.json` a `r2/cors.json` (ignorado por Git). Reemplazá
`allowed.origins` con los orígenes HTTPS reales desde los que se usa la app;
quitá localhost y el dominio de ejemplo. Un origen no lleva ruta ni barra final.
Si se usan tanto un dominio propio como uno de Vercel, incluí ambos explícitamente.

Conservá los métodos `GET`, `PUT`, los headers `Content-Type`, `If-None-Match`,
los headers expuestos `ETag`, `Content-Length`, `Content-Type` y `maxAgeSeconds: 3600`.

```bash
cp r2/cors.example.json r2/cors.json
# Editar r2/cors.json antes de ejecutar el siguiente comando.
npx wrangler r2 bucket cors set bolsillo-files-prod --file r2/cors.json
npx wrangler r2 bucket cors list bolsillo-files-prod
```

Este archivo usa el formato de **Wrangler**; el editor JSON del dashboard usa
otro formato. El comando reemplaza la política del bucket. CORS también es
necesario con URLs firmadas; no vuelve público el bucket.
[Documentación de CORS](https://developers.cloudflare.com/r2/buckets/cors/).

## 3. Variables en Convex Production

En el dashboard de Convex, seleccioná el proyecto correcto y su deployment
**Production** → Settings → Environment Variables. Agregá:

| Variable | Valor |
| --- | --- |
| `R2_ACCOUNT_ID` | Account ID de Cloudflare, sin URL |
| `R2_BUCKET_NAME` | `bolsillo-files-prod`, o el nombre elegido |
| `R2_ACCESS_KEY_ID` | Access Key ID S3 del token limitado a ese bucket |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key S3 del mismo token |
| `R2_PRESIGN_TTL_SECONDS` | `300` (el código admite entre 60 y 900 segundos) |

Alternativamente, desde este repositorio vinculado al proyecto correcto, usá
`--prod` explícitamente. Confirmá que el shell no tenga un `CONVEX_DEPLOY_KEY`
de otro deployment ni overrides de Convex self-hosted. Los valores omitidos se
piden de forma interactiva para evitar guardar secretos en el historial:

```bash
npx convex env set R2_ACCOUNT_ID --prod
npx convex env set R2_BUCKET_NAME bolsillo-files-prod --prod
npx convex env set R2_ACCESS_KEY_ID --prod
npx convex env set R2_SECRET_ACCESS_KEY --prod
npx convex env set R2_PRESIGN_TTL_SECONDS 300 --prod
npx convex env list --names-only --prod
```

`R2_LOCAL_ENDPOINT` debe estar **ausente** en producción; es exclusivo de MinIO
local. Si se configuró por error, eliminalo en ese deployment. Las variables R2
se leen en las Node actions de Convex: ponerlas solo en Vercel o `.env.local` no
configura el backend. Nunca uses el prefijo `NEXT_PUBLIC_` para las credenciales.
Verificá además que el `CLERK_JWT_ISSUER_DOMAIN` existente sea el de Clerk Production.
[Variables de Convex](https://docs.convex.dev/cli/reference/env).

## 4. Revisar Vercel Production

En el proyecto Vercel, revisá estas variables con alcance **Production**:

| Variable | Valor / propósito |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | Production Deploy Key del mismo deployment Convex, con permiso `deployment:deploy` |
| `NEXT_PUBLIC_CONVEX_URL` | URL HTTPS del deployment Convex de producción; el build actual también la inyecta mediante `--cmd-url-env-var-name` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Publishable key de Clerk Production |
| `CLERK_SECRET_KEY` | Secret key de esa misma instancia de Clerk Production |

Conservá las rutas existentes de Clerk (`/sign-in`, `/sign-up` y fallback `/`).
Este feature no agrega secretos R2 a Vercel. Verificá que la producción no apunte
a `localhost`, MinIO ni Convex dev. Los Preview Deployments no despliegan Convex
con el comando actual; requieren un backend de prueba con las nuevas funciones
para probar adjuntos antes del merge.
[Deploy Convex con Vercel](https://docs.convex.dev/production/hosting/vercel).

## Antes del merge

- [ ] Bucket de producción creado, privado y con credenciales S3 limitadas a él.
- [ ] Política CORS aplicada y verificada con los orígenes reales de producción.
- [ ] Las cinco variables R2 están en Convex Production; `R2_LOCAL_ENDPOINT` está ausente.
- [ ] Clerk, URL de Convex y deploy key corresponden a producción.
- [ ] Checks del PR aprobados. La prueba local con MinIO pasó; queda pendiente verificar R2 real.

## Después del deploy

1. Confirmá que terminó el deployment de Vercel y que Convex publicó las funciones,
   tablas e índices de archivos. No hace falta importar los datos de prueba locales.
2. Con un superadmin de producción, abrí `/superadmin`, elegí una cuenta de prueba
   y habilitá `transactions.files`. Si falta el primer superadmin, usá el bootstrap
   documentado en README con `--prod` y un ID de usuario de Clerk Production;
   quitá la variable de bootstrap después de confirmar el acceso.
3. Desde el origen HTTPS de producción, creá un movimiento con TXT, PDF e imagen;
   recargá, abrí vistas previas, descargá, renombrá y eliminá un adjunto. Confirmá
   que otra cuenta no puede acceder a los archivos.
4. Eliminá el movimiento y probá también eliminar un bolsillo archivado con
   adjuntos. Verificá la eliminación física en R2 y que no queden errores en
   `r2DeletionJobs` ni en las acciones de Convex. El borrado es asíncrono y tiene
   reintentos; hay reconciliación horaria para limpiezas pendientes.
5. Habilitá la función para las demás cuentas cuando pase el smoke test con R2.

Si aparece un problema, deshabilitá `transactions.files` para las cuentas
afectadas. Esto conserva los archivos y bloquea nuevas operaciones del feature.
Mantené las credenciales para que las limpiezas pendientes puedan terminar.
