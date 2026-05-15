CREATE TABLE IF NOT EXISTS public.client_states (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "channelId" text NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  "phonePk" text NOT NULL,
  "contactName" text,
  "companyName" text,
  cnpj text,
  "firstSeenAt" timestamptz NOT NULL,
  "lastSeenAt" timestamptz NOT NULL,
  "firstIssueAt" timestamptz,
  "lastIssueAt" timestamptz,
  "resolvedAt" timestamptz,
  "currentStatus" text NOT NULL,
  "currentSeverity" text NOT NULL DEFAULT 'info',
  "currentLabels" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "openConversationIds" integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  "lastRunId" text REFERENCES public.analysis_runs(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS client_states_tenant_channel_phone_unique
  ON public.client_states ("tenantId", "channelId", "phonePk");

CREATE INDEX IF NOT EXISTS client_states_tenant_channel_status_idx
  ON public.client_states ("tenantId", "channelId", "currentStatus");
