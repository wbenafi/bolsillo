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
