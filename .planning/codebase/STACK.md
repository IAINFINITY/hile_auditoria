# Stack

## Core runtime
- Language: `TypeScript` (`src/**/*.ts`, `src/**/*.tsx`)
- Runtime: `Node.js >=20` (see `package.json`)
- Framework: `Next.js 16.1.6` with App Router (`src/app`)
- UI: `React 19` + `react-dom 19`
- Styling: `Tailwind CSS v4` (`postcss.config.mjs`, `src/app/globals.css`)

## Backend and data
- ORM: `Prisma 6` (`prisma/schema.prisma`)
- Database: `PostgreSQL` via Supabase (`DATABASE_URL`, `DIRECT_URL`)
- Auth/session: `@supabase/supabase-js` + `@supabase/ssr`

## Tooling
- Lint: `ESLint 9` + `eslint-config-next` (`eslint.config.mjs`)
- Typecheck: `tsc --noEmit` (`npm run typecheck`)
- Build/start: `next build`, `next start`

## Key dependencies
- `next`, `react`, `react-dom`
- `@prisma/client`, `prisma`
- `@supabase/supabase-js`, `@supabase/ssr`
- `react-icons`

## Configuration and environment
- App/env loading for audit logic: `src/lib/server/audit/config.ts`
- Security headers: `next.config.ts`
- Route protection: `src/proxy.ts`
- Prisma logging toggle: `src/lib/db/prisma.ts` (`PRISMA_LOG_QUERIES`)

## High-level platform shape
- Single Next.js app with mixed responsibilities:
  - Dashboard/UI in `src/features/dashboard/*`
  - API handlers in `src/app/api/*`
  - Audit/integration services in `src/lib/server/audit/*`
- Database schema already modeled for multi-tenant and historical persistence (`Tenant`, `Channel`, `AnalysisRun`, `Report`, `Insight`, `Gap`).

