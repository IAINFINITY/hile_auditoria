# Structure

## Root layout
- `src/` application source
- `prisma/` schema and SQL scripts
- `public/` static assets
- `.planning/` GSD artifacts and codebase mapping

## App and API
- `src/app/layout.tsx` global layout
- `src/app/page.tsx` main dashboard page
- `src/app/globals.css` shared CSS baseline
- `src/app/api/**/route.ts` API route handlers

## Dashboard feature slice
- `src/features/dashboard/sections/*` page sections (metrics, gaps, insights, movement, report, settings, navigation)
- `src/features/dashboard/charts/*` reusable chart-like components
- `src/features/dashboard/hooks/*` state and reveal behavior
- `src/features/dashboard/shared/*` constants, helpers, typed contracts

## Server domain slice
- `src/lib/server/audit/config.ts` env and app config parsing
- `src/lib/server/audit/chatwootClient.ts` Chatwoot HTTP integration
- `src/lib/server/audit/chatMapper.ts` normalization/mapping of conversation logs
- `src/lib/server/audit/difyClient.ts` Dify HTTP integration
- `src/lib/server/audit/auditService.ts` report generation orchestration
- `src/lib/server/audit/auditPersistence.ts` DB persistence/read model

## Auth and infra
- `src/proxy.ts` request guard for API routes
- `src/lib/supabase/browser.ts` browser Supabase client
- `src/lib/supabase/server.ts` server/proxy Supabase client
- `src/lib/auth/server.ts` admin authorization helper
- `src/lib/db/prisma.ts` Prisma singleton

## Naming conventions observed
- API routes use folder-per-endpoint with `route.ts`.
- Feature files use PascalCase for components and camelCase for hooks/helpers.
- Domain files are mostly lower camel/snake hybrid with clear intent names.

