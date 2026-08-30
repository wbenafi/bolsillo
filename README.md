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
