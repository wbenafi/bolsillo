# Bolsillo

Bolsillo permite separar dinero por propósito, registrar ingresos y gastos y ver el saldo disponible en tiempo real. La interfaz es mobile-first y el backend usa Convex con identidad de Clerk.

## Requisitos

- Node.js 22 o superior
- Una aplicación de Clerk
- Un proyecto de Convex

## Instalación

```bash
npm install
cp .env.example .env.local
```

Completá `.env.local` con:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY`, desde Clerk.
- `CONVEX_DEPLOYMENT` y `NEXT_PUBLIC_CONVEX_URL`, al ejecutar `npm run convex:dev`.
- `CLERK_JWT_ISSUER_DOMAIN`, el dominio issuer de la instancia de Clerk, sin una barra final.

## Integración Clerk + Convex

1. En Clerk, creá un JWT template llamado exactamente `convex` usando la plantilla de Convex.
2. Configurá `CLERK_JWT_ISSUER_DOMAIN` en el deployment de Convex:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://tu-instancia.clerk.accounts.dev
```

3. Vinculá el proyecto y generá los tipos:

```bash
npm run convex:dev
```

Convex toma el propietario exclusivamente de `ctx.auth.getUserIdentity().subject`; ningún `userId` enviado por el navegador se acepta como fuente de autorización.

## Archivos privados de movimientos con Cloudflare R2

La función `transactions.files` permite adjuntar hasta cinco archivos JPG, PNG, WebP, PDF o TXT de 2 MB cada uno. Está deshabilitada por defecto y solo un superadmin puede habilitarla por cuenta.

Antes del merge, seguí la [guía de configuración de producción](docs/transaction-files-production.md):
bucket privado, CORS, variables de Convex y Vercel, y activación por cuenta después del deploy.

### Crear los buckets

Usá buckets separados para desarrollo y producción. Los buckets deben permanecer privados:

```bash
npx wrangler login
npx wrangler r2 bucket create bolsillo-files-dev
npx wrangler r2 bucket create bolsillo-files-prod
```

En Cloudflare, creá para cada bucket un token R2 con permiso **Object Read & Write** limitado exclusivamente a ese bucket. Guardá el Access Key ID y el Secret Access Key cuando se muestren; el secreto no vuelve a estar disponible.

Copiá `r2/cors.example.json`, reemplazá `https://bolsillo.example.com` por el origen real de la aplicación y aplicá la política al bucket correspondiente:

```bash
cp r2/cors.example.json r2/cors.json
npx wrangler r2 bucket cors set bolsillo-files-dev --file r2/cors.json
npx wrangler r2 bucket cors list bolsillo-files-dev
```

`r2/cors.json` es configuración local y no debe contener credenciales. Agregá explícitamente cada origen de Preview que necesite probar cargas; R2 valida el origen aunque la URL ya esté firmada.

### Configurar Convex

Las credenciales se usan únicamente desde Node actions de Convex. Configuralas en cada deployment, sin el prefijo `NEXT_PUBLIC_`:

```bash
npx convex env set R2_ACCOUNT_ID
npx convex env set R2_BUCKET_NAME bolsillo-files-dev
npx convex env set R2_ACCESS_KEY_ID
npx convex env set R2_SECRET_ACCESS_KEY
npx convex env set R2_PRESIGN_TTL_SECONDS 300
```

Repetí los comandos con `--prod` y el bucket de producción. Omitir el valor de los secretos permite ingresarlos interactivamente sin guardarlos en el historial del shell.

Las cargas usan URLs `PUT` firmadas por cinco minutos. Antes de guardar el movimiento, Convex vuelve a descargar cada objeto desde R2 y valida tamaño, MIME y firma del contenido. Las vistas previas y descargas solicitan URLs `GET` nuevas; las URLs firmadas nunca se persisten en la base de datos.

## Desarrollo

En dos terminales:

```bash
npm run convex:dev
npm run dev
```

La app estará disponible en `http://localhost:3000`.

### Probar transaction files R2 localmente

Podés probar sin cuenta ni credenciales de Cloudflare usando **MinIO + Convex
local**. MinIO implementa la API S3 que usa el feature, incluidas las URLs firmadas.
Es una prueba de compatibilidad S3; la integración final con R2 se verifica contra
un bucket real de desarrollo. Clerk sigue usando tu instancia configurada y requiere
conexión a Internet.

El instalador incluido funciona en **Linux x64**, sin Docker. Descarga una versión
fija de [MinIO Community (AGPLv3)](https://dl.min.io/server/minio/release/linux-amd64/)
y verifica su SHA-256 antes de ejecutarla. Convex usa Node.js 22 para sus acciones.

Primera vez, con Clerk y `CLERK_JWT_ISSUER_DOMAIN` completos en `.env.local`:

```bash
npx convex deployment create local --select
```

Si ya existe un deployment local, usá `npx convex deployment select local`.
La selección actualiza las URLs de Convex en `.env.local`. La base local empieza
vacía y conserva sus propios datos, separados del deployment cloud.
Más información: [deployments locales de Convex](https://docs.convex.dev/cli/local-deployments).

Detené los servidores de desarrollo anteriores y arrancá todo con:

```bash
npm run dev:local
```

El comando inicia MinIO, crea el bucket privado `bolsillo-files-local` si no existe,
configura CORS y las variables del backend local, espera a que Convex compile e
inicia Next.js. Rechaza deployments cloud y puertos ocupados. `Ctrl+C` detiene los
tres servicios; los datos persisten entre arranques.

| Servicio | Dirección / almacenamiento |
| --- | --- |
| App | `http://localhost:3000` |
| Convex local | `http://127.0.0.1:3210` (puerto asignado por Convex) |
| API S3 local | `http://127.0.0.1:9000` |
| Consola MinIO | `http://127.0.0.1:9001` |
| Archivos | `.local/minio/` |
| Base de datos | `.convex/` |

La consola MinIO usa `bolsillo-local` / `bolsillo-local-testing-only`: son
credenciales fijas **solo de testing local**, y MinIO escucha únicamente en
loopback. CORS permite `http://localhost:3000` y `http://127.0.0.1:3000`.
`.local/` y `.convex/` están excluidos de Git.

Con los servicios corriendo, habilitá los adjuntos para tu correo registrado en Clerk:

```bash
npm run local:enable-files -- tu-correo@example.com
```

Este comando consulta el usuario en Clerk, crea/actualiza su cuenta en Convex
**local**, le da rol superadmin local y habilita `transactions.files` usando la
mutación administrativa existente. No cambia roles en Clerk ni en Convex cloud.
También podés habilitar otras cuentas desde `/superadmin`.

En la app, creá un bolsillo y un movimiento, adjuntá un TXT, PDF o imagen de hasta
2 MB, guardalo y probá vista previa, descarga, renombre y eliminación. Hay una
prueba automatizada contra los servicios reales locales:

```bash
npm run test:local-files
```

Verifica límites, CORS, carga, validación en Convex, descarga, firmas, acceso
privado, protección contra sobrescritura, renombre y borrado físico. Crea una
cuenta técnica local y elimina el bolsillo y movimiento de prueba al terminar.

### Informe de pruebas con videos

Con `npm run dev:local` corriendo, ejecutá:

```bash
npx playwright install chromium
npm run test:files:report
```

El recorrido usa una cuenta dedicada `bolsillo.qa+clerk_test@example.com`,
comprobantes ficticios y Chromium. Crea diez videos WebM, capturas, descargas
verificadas y un informe HTML en `output/transaction-files-qa/<fecha>/`.
`output/transaction-files-qa/index.html` abre el último informe. Los datos de
demostración permanecen en la cuenta QA para poder revisarlos; los escenarios de
borrado eliminan sus propios movimientos y archivos.

Se verifican los cinco formatos, persistencia, vistas previas, descargas, edición,
arrastre, cancelación, límites, contenido inválido, reintentos, permisos, móvil,
eliminación de movimientos y eliminación de bolsillos. También se comprueban
firmas, expiración y aislamiento entre cuentas contra el almacenamiento local.

El comando inicia y detiene un relay HTTP exclusivo para las solicitudes reales
a Clerk, limitado a loopback y al dominio de desarrollo configurado. Resuelve el
dominio antes de abrir Chromium para evitar errores intermitentes de DNS en el
entorno de QA. La app, Convex y MinIO reciben las solicitudes de los escenarios
directamente; las respuestas de autenticación no se simulan. Las sesiones y
credenciales no se guardan en el informe.

Podés abrir el HTML directamente o servir la carpeta:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory output/transaction-files-qa
```

El informe quedará en `http://localhost:4173`.

Para volver a Convex cloud, detené `dev:local` y ejecutá:

```bash
npx convex deployment select dev
npm run convex:dev
# En otra terminal:
npm run dev
```

Para probar con R2 real desde localhost, configurá las variables `R2_*` en el
deployment cloud como se describe arriba y aplicá `r2/cors.local.json` al bucket
dedicado con `npx wrangler r2 bucket cors set bolsillo-files-dev --file r2/cors.local.json`.
Ese comando reemplaza la política CORS: conservá los otros orígenes si compartís
el bucket. Escribir variables solamente en `.env.local` no las configura en Convex.
`R2_LOCAL_ENDPOINT` es exclusivo del emulador local y no debe configurarse en cloud.

## Verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Deploy

1. Importá el repositorio en Vercel.
2. Agregá las variables de Clerk y `NEXT_PUBLIC_CONVEX_URL` al proyecto de Vercel.
3. Generá una Production Deploy Key de Convex con permiso `deployment:deploy` y guardala en Vercel como `CONVEX_DEPLOY_KEY`, limitada al ambiente Production.
4. En Convex, configurá `CLERK_JWT_ISSUER_DOMAIN` para producción.
5. Desplegá el frontend en Vercel. El `buildCommand` de `vercel.json` publica primero las funciones, el schema y los índices de Convex; si ese paso falla, la release también falla.

Los Preview Deployments ejecutan únicamente el build de Next.js. Para darles un backend Convex aislado, configurá adicionalmente una Preview Deploy Key siguiendo la guía oficial de Convex.

Las rutas `/sign-in` y `/sign-up` son públicas. El resto queda protegido por Clerk en `proxy.ts` y cada query o mutation vuelve a comprobar identidad y propiedad en Convex.

## Superadmin y control de acceso

Bolsillo mantiene en Convex un registro local de usuarios y cuentas. Cada usuario de Clerk recibe una cuenta personal; los bolsillos nuevos se vinculan a esa cuenta y los registros históricos se migran de forma idempotente.

Para crear el primer superadmin en un deployment:

```bash
npx convex env set SUPERADMIN_CLERK_USER_IDS user_xxx
```

Después, iniciá sesión una vez. `users.ensureCurrent` persistirá el rol `superadmin` en Convex. Confirmá el acceso a `/superadmin` y eliminá la variable de bootstrap:

```bash
npx convex env remove SUPERADMIN_CLERK_USER_IDS
```

Desde `/superadmin` se pueden suspender o reactivar cuentas, administrar roles de plataforma, configurar acceso por función, aplicar límites de bolsillos y consultar la auditoría. Las restricciones se validan nuevamente en las funciones de Convex; la interfaz solo refleja el resultado.

### Sincronización con Clerk

La sesión crea o actualiza la cuenta actual de forma síncrona. Para mantener nombre, correo, avatar y eliminaciones actualizados aunque el usuario no vuelva a iniciar sesión, configurá también un webhook de Clerk:

1. En Clerk, creá un endpoint `https://<deployment>.convex.site/clerk-users-webhook`.
2. Suscribilo a `user.created`, `user.updated` y `user.deleted`.
3. Guardá su signing secret en el deployment de Convex:

```bash
npx convex env set CLERK_WEBHOOK_SIGNING_SECRET whsec_xxx
```

La firma se verifica antes de procesar cada evento. Las eliminaciones de Clerk conservan los datos financieros y suspenden la cuenta correspondiente.

### Funciones administrables

- `wallets.create`: creación y restauración de bolsillos; admite un límite de bolsillos activos.
- `transactions.manage`: creación, edición y eliminación de movimientos.
- `tags.manage`: creación, edición y eliminación de tags.
- `wallets.share`: generación y uso del resumen compartible.
- `transactions.files`: carga, vista previa, descarga y eliminación de archivos privados en movimientos; deshabilitada por defecto.
