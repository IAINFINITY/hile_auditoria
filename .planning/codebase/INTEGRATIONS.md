# Integrations

## Chatwoot
- Client wrapper: `src/lib/server/audit/chatwootClient.ts`
- Main endpoints used:
  - `GET /api/v1/profile`
  - `GET /api/v1/accounts/{accountId}/inboxes`
  - `GET /api/v1/accounts/{accountId}/conversations`
  - `GET /api/v1/accounts/{accountId}/conversations/{conversationId}`
  - `GET /api/v1/accounts/{accountId}/conversations/{conversationId}/messages`
- Auth method: `api_access_token` header.
- Connection/context APIs:
  - `src/app/api/chatwoot/target/route.ts`
  - `src/app/api/system-check/route.ts`

## Dify
- Client wrapper: `src/lib/server/audit/difyClient.ts`
- Supports:
  - `POST /chat-messages` (mode `chat`)
  - `POST /workflows/run` (mode `workflow`)
- Auth method: `Authorization: Bearer {DIFY_API_KEY}`.
- URL normalization logic for `/v1` and `/chat/*` patterns implemented in `normalizeDifyBaseUrl`.

## Supabase
- Browser client: `src/lib/supabase/browser.ts`
- Server/proxy client: `src/lib/supabase/server.ts`
- Authorization check: RPC `is_admin_user` via `src/lib/auth/server.ts`.
- API protection middleware-like layer: `src/proxy.ts` for `/api/*` except `/api/health`.

## Prisma/Postgres
- Prisma client singleton: `src/lib/db/prisma.ts`
- Schema: `prisma/schema.prisma`
- SQL scripts:
  - `prisma/sql/2026-05-14_auth_admin_users.sql`
  - `prisma/sql/2026-05-14_dedup_and_uniques.sql`

## Internal integration paths
- Report orchestration endpoints:
  - `src/app/api/report-day/start/route.ts`
  - `src/app/api/report-day/status/route.ts`
  - `src/app/api/report-day/by-date/route.ts`
  - `src/app/api/report-day/available-dates/route.ts`
- Service layer:
  - `src/lib/server/audit/auditService.ts`
  - `src/lib/server/audit/auditPersistence.ts`

