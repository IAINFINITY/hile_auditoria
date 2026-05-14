# Conventions

## TypeScript and module usage
- Path alias `@/*` points to `src/*` (`tsconfig.json`).
- Mixed strictness posture:
  - `strict: false` globally.
  - Several files still use `any` in integration boundaries.
- ESM style imports/exports used consistently.

## API conventions
- Every endpoint returns JSON with a clear `error` key for failure paths.
- Runtime explicitly set to Node for server routes: `export const runtime = "nodejs"`.
- Date inputs are normalized via shared utilities (`src/lib/server/apiUtils.ts`).

## Persistence conventions
- Prisma model names are singular, mapped to snake_case DB tables using `@@map`.
- Composite uniques and indexes are used heavily for dedup/idempotency.
- Report materialization stores both markdown and JSON snapshots (`Report`).

## UI conventions
- One-page dashboard with section-based composition.
- Controller hook centralizes fetch and UI interaction state.
- Reusable chart components provide visual consistency.

## Security conventions
- Security headers configured in `next.config.ts`.
- API route access mediated by `src/proxy.ts`.
- Admin access evaluated through Supabase RPC (`is_admin_user`).

## Error handling patterns
- Integration clients throw enriched `Error` with status/context message.
- Routes catch unknown errors and return user-facing messages in PT-BR.
- Background jobs store failure state and append event logs.

## Areas to standardize further
- Remove lingering `any` and tighten parser contracts around external payloads.
- Normalize text encoding/charset handling in route messages.
- Gradually move to `strict: true` with staged type hardening.

