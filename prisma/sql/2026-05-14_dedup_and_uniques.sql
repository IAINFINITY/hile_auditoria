-- Etapa 2 (longo prazo): deduplicação + blindagem contra duplicatas
-- Execute no Supabase SQL Editor no banco deste app.

-- 1) CONTACTS: manter o registro mais recente por (tenantId, chatwootContactId)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "chatwootContactId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM contacts
  WHERE "chatwootContactId" IS NOT NULL
)
DELETE FROM contacts c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 2) CONTACTS: manter o registro mais recente por (tenantId, identifierHash)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "identifierHash"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM contacts
  WHERE "identifierHash" IS NOT NULL
)
DELETE FROM contacts c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 3) CONVERSATION_ANALYSES: manter só 1 por (runId, conversationId)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "runId", "conversationId"
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM conversation_analyses
)
DELETE FROM conversation_analyses ca
USING ranked r
WHERE ca.id = r.id
  AND r.rn > 1;

-- 4) ANALYSIS_CACHE: manter o mais recente por (tenantId, conversationId, sourceFingerprint)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "conversationId", "sourceFingerprint"
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM analysis_cache
)
DELETE FROM analysis_cache ac
USING ranked r
WHERE ac.id = r.id
  AND r.rn > 1;

-- 5) Constraints únicas permanentes
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_chatwoot_contact_unique
  ON contacts ("tenantId", "chatwootContactId")
  WHERE "chatwootContactId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_identifier_hash_unique
  ON contacts ("tenantId", "identifierHash")
  WHERE "identifierHash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_analyses_run_conversation_unique
  ON conversation_analyses ("runId", "conversationId");

CREATE UNIQUE INDEX IF NOT EXISTS analysis_cache_tenant_conversation_fingerprint_unique
  ON analysis_cache ("tenantId", "conversationId", "sourceFingerprint");

-- 6) Apenas uma execução "running" por dia/canal/tenant
CREATE UNIQUE INDEX IF NOT EXISTS analysis_runs_one_running_per_day_channel
  ON analysis_runs ("tenantId", "channelId", "dateRef")
  WHERE status = 'running';
