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
3. En Convex, configurá `CLERK_JWT_ISSUER_DOMAIN` para producción.
4. Ejecutá `npx convex deploy` y desplegá el frontend en Vercel.

Las rutas `/sign-in` y `/sign-up` son públicas. El resto queda protegido por Clerk en `proxy.ts` y cada query o mutation vuelve a comprobar identidad y propiedad en Convex.
