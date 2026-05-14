# Architecture

## System pattern
- Monolithic Next.js application with App Router and server-side API handlers.
- Feature-oriented frontend under `src/features/dashboard`.
- Service-oriented backend logic under `src/lib/server/audit`.

## Main layers
1. Presentation layer
- `src/app/page.tsx` bootstraps dashboard shell.
- Section components in `src/features/dashboard/sections/*`.
- Chart primitives in `src/features/dashboard/charts/*`.

2. Interaction/state layer
- UI/controller hooks:
  - `src/features/dashboard/hooks/useDashboardController.ts`
  - `src/features/dashboard/hooks/useRevealOnScroll.ts`
- Shared domain types/helpers:
  - `src/features/dashboard/shared/types.ts`
  - `src/features/dashboard/shared/helpers.ts`

3. API layer
- Route handlers in `src/app/api/*`.
- Health/config/report/audit endpoints expose data and trigger processing jobs.
- Security gate before API execution through `src/proxy.ts`.

4. Domain/service layer
- Chatwoot mapper/client: `chatMapper.ts`, `chatwootClient.ts`
- Dify analysis client: `difyClient.ts`
- Audit orchestration: `auditService.ts`
- Persistence and read-model hydration: `auditPersistence.ts`

5. Data layer
- Prisma models define tenant/channel/contact/conversation/run/report/insight/gap graph.
- Atomic and transactional persistence with `prisma.$transaction`.

## Data flow (overview run)
1. `POST /api/report-day/start` creates in-memory job state and DB run record.
2. `buildDailyReport` collects conversations and performs AI analysis.
3. Progress events are appended to job state and optional DB events.
4. `persistCompletedRun` writes normalized entities and final report.
5. UI polls `status` and fetches by-date/history endpoints.

## Cross-cutting concerns
- Authorization: Supabase auth user + `is_admin_user` RPC check.
- Operational resilience: stale running runs are marked failed before starting a new run.
- Persistence strategy: overwrite by date with dedup constraints and cleanup of old completed runs for same key.

