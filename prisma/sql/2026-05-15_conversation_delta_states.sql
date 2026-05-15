-- Incremental state per conversation for delta analysis
create table if not exists public.conversation_delta_states (
  id text primary key,
  "tenantId" text not null references public.tenants(id) on delete cascade,
  "channelId" text not null references public.channels(id) on delete cascade,
  "chatwootConversationId" integer not null,
  "lastAnalyzedMessageId" integer,
  "lastAnalyzedAt" timestamptz,
  "lastMessageAt" timestamptz,
  "lastMessageRole" text,
  "stateSummary" text,
  "lastDeltaHash" text,
  "lastStatus" text,
  "lastLabels" text[] not null default '{}',
  "lastFullAt" timestamptz,
  "lastRunMode" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table if exists public.conversation_delta_states
  add column if not exists "lastFullAt" timestamptz;

alter table if exists public.conversation_delta_states
  add column if not exists "lastRunMode" text;

create unique index if not exists conversation_delta_states_tenant_channel_conversation_uq
  on public.conversation_delta_states ("tenantId", "channelId", "chatwootConversationId");

create index if not exists conversation_delta_states_tenant_channel_last_analyzed_idx
  on public.conversation_delta_states ("tenantId", "channelId", "lastAnalyzedAt");
