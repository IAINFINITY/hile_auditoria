-- Normalize responsible owner tracking on client tables.
-- Safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ResponsibleBucket'
  ) THEN
    CREATE TYPE "ResponsibleBucket" AS ENUM ('ia', 'suellen', 'samuel');
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.client_records
  ADD COLUMN IF NOT EXISTS "responsibleBucket" "ResponsibleBucket" NOT NULL DEFAULT 'ia',
  ADD COLUMN IF NOT EXISTS "responsibleLabel" text,
  ADD COLUMN IF NOT EXISTS "responsibleMessageCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "responsibleMessageBreakdown" jsonb;

ALTER TABLE IF EXISTS public.client_states
  ADD COLUMN IF NOT EXISTS "responsibleBucket" "ResponsibleBucket" NOT NULL DEFAULT 'ia',
  ADD COLUMN IF NOT EXISTS "responsibleLabel" text,
  ADD COLUMN IF NOT EXISTS "responsibleMessageCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "responsibleMessageBreakdown" jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_records'
      AND column_name = 'responsibleBucket'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE public.client_records
      ALTER COLUMN "responsibleBucket" TYPE "ResponsibleBucket"
      USING (
        CASE
          WHEN lower(trim(COALESCE("responsibleBucket", ''))) IN ('ia', 'suellen', 'samuel')
            THEN lower(trim("responsibleBucket"))::"ResponsibleBucket"
          ELSE 'ia'::"ResponsibleBucket"
        END
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_states'
      AND column_name = 'responsibleBucket'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE public.client_states
      ALTER COLUMN "responsibleBucket" TYPE "ResponsibleBucket"
      USING (
        CASE
          WHEN lower(trim(COALESCE("responsibleBucket", ''))) IN ('ia', 'suellen', 'samuel')
            THEN lower(trim("responsibleBucket"))::"ResponsibleBucket"
          ELSE 'ia'::"ResponsibleBucket"
        END
      );
  END IF;
END
$$;

-- Backfill missing values.
UPDATE public.client_records
SET
  "responsibleBucket" = CASE
    WHEN lower(trim(COALESCE("responsibleBucket"::text, ''))) IN ('ia', 'suellen', 'samuel')
      THEN lower(trim("responsibleBucket"::text))::"ResponsibleBucket"
    ELSE 'ia'::"ResponsibleBucket"
  END,
  "responsibleMessageCount" = COALESCE("responsibleMessageCount", 0)
WHERE "responsibleBucket" IS NULL
   OR lower(trim(COALESCE("responsibleBucket"::text, ''))) NOT IN ('ia', 'suellen', 'samuel')
   OR "responsibleMessageCount" IS NULL;

UPDATE public.client_states
SET
  "responsibleBucket" = CASE
    WHEN lower(trim(COALESCE("responsibleBucket"::text, ''))) IN ('ia', 'suellen', 'samuel')
      THEN lower(trim("responsibleBucket"::text))::"ResponsibleBucket"
    ELSE 'ia'::"ResponsibleBucket"
  END,
  "responsibleMessageCount" = COALESCE("responsibleMessageCount", 0)
WHERE "responsibleBucket" IS NULL
   OR lower(trim(COALESCE("responsibleBucket"::text, ''))) NOT IN ('ia', 'suellen', 'samuel')
   OR "responsibleMessageCount" IS NULL;

CREATE INDEX IF NOT EXISTS client_records_tenant_channel_owner_idx
  ON public.client_records ("tenantId", "channelId", "responsibleBucket");

CREATE INDEX IF NOT EXISTS client_states_tenant_channel_owner_idx
  ON public.client_states ("tenantId", "channelId", "responsibleBucket");
