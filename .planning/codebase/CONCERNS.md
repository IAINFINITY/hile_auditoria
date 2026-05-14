# Concerns

## Security concerns
1. Global auth bypass flag risk
- `ALLOW_UNSAFE_DIRECT_ANALYSIS=true` can bypass safer report orchestration paths in some endpoints (`src/app/api/analyze-day/route.ts`, `src/app/api/report-day/route.ts`).
- Keep disabled in production and monitor env drift.

2. Broad API gate dependency on proxy behavior
- Protection relies on `src/proxy.ts` matcher and Supabase session resolution.
- Any mismatch/new route outside matcher may become unintentionally public.

3. Authorization RPC coupling
- Access decision depends on `is_admin_user` RPC.
- If RPC/policy breaks, authorized users may lock out or route behavior can degrade.

## Data integrity concerns
1. In-memory job store volatility
- `src/lib/server/reportJobs.ts` stores run state in process memory.
- Restart/deploy clears state; long-running job observability can be lost.

2. Complex persistence transaction surface
- `persistCompletedRun` is large and performs many operations in one transaction.
- High complexity increases risk of edge-case regressions and harder debugging.

3. Duplicate and overwrite semantics
- There is explicit cleanup of older runs for same date/channel after successful persistence.
- This is intended but needs clear product-level audit trail expectations.

## Reliability concerns
1. Mixed typing at integration boundaries
- Multiple files still use `any` for external payloads and route errors.
- Raises runtime parsing risk when providers change payload formats.

2. Encoding/charset regressions
- Several user-facing strings show mojibake traces in some files.
- Can degrade UX and may indicate inconsistent editor/file encoding history.

3. Strict mode disabled
- `tsconfig.json` uses `strict: false`, reducing static guarantees.
- Technical debt likely to grow if not phased toward stricter typing.

## Priority recommendations
- P1: Keep unsafe-direct mode disabled and audited in all environments.
- P1: Add API auth regression tests and explicit protected-route inventory.
- P2: Split persistence transaction into smaller testable units.
- P2: Introduce schema validators for Chatwoot/Dify payload parsing.
- P3: Plan incremental migration toward stronger TypeScript strictness.

