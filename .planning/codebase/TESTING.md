# Testing

## Current state
- No dedicated unit/integration test suite is present in repository.
- No `*.test.ts` or `*.spec.ts` files detected under `src/`.
- Validation currently depends on:
  - `npm run typecheck`
  - `npm run lint`
  - Manual runtime verification through dashboard/API flows
  - External static security scan (Semgrep) run ad hoc

## Existing quality gates
- TypeScript compile gate (`tsc --noEmit`).
- ESLint with Next.js core web vitals presets (`eslint.config.mjs`).
- Build-time checks via `next build`.

## Critical test gaps
- API behavior tests for:
  - auth status route
  - report start/status lifecycle
  - by-date/history endpoints
- Service tests for:
  - chat mapping normalization
  - Dify parsing and fallback behavior
  - dedup/idempotent persistence contracts
- Auth policy tests:
  - unauthorized and forbidden path coverage
  - proxy matcher and route allowlist behavior

## Suggested minimal test strategy
1. Add route handler tests for `src/app/api/report-day/*`.
2. Add pure-function tests for `chatMapper.ts` and parser helpers.
3. Add Prisma integration tests against a disposable test DB schema.
4. Add security regression checks for protected API routes.

## Operational regression checklist
- Start overview for a date with and without previous run.
- Confirm persisted report appears in by-date endpoint.
- Confirm duplicate execution rules behave as expected.
- Confirm unauthorized requests return 401/403 deterministically.

