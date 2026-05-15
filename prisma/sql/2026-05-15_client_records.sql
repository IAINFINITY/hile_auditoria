CREATE TABLE IF NOT EXISTS public.client_records (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "channelId" text NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  "runId" text NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  "dateRef" timestamptz NOT NULL,
  "phonePk" text NOT NULL,
  "contactName" text,
  "companyName" text,
  cnpj text,
  "gapsJson" jsonb,
  "attentionsJson" jsonb,
  labels text[] NOT NULL DEFAULT ARRAY[]::text[],
  "conversationIds" integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  "chatLinks" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "openedAt" timestamptz,
  "closedAt" timestamptz,
  status text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS client_records_run_phone_unique
  ON public.client_records ("runId", "phonePk");

CREATE INDEX IF NOT EXISTS client_records_tenant_channel_date_idx
  ON public.client_records ("tenantId", "channelId", "dateRef");

CREATE INDEX IF NOT EXISTS client_records_tenant_phone_idx
  ON public.client_records ("tenantId", "phonePk");
