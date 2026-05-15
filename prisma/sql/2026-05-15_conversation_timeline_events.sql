-- Timeline operacional por conversa/cliente
create table if not exists public.conversation_timeline_events (
  id text primary key,
  "tenantId" text not null references public.tenants(id) on delete cascade,
  "channelId" text not null references public.channels(id) on delete cascade,
  "dateRef" timestamptz not null,
  "chatwootConversationId" integer not null,
  "phonePk" text not null,
  "eventType" text not null,
  severity text not null default 'info',
  reason text not null,
  source text not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists conversation_timeline_events_tenant_channel_date_idx
  on public.conversation_timeline_events ("tenantId", "channelId", "dateRef");

create index if not exists conversation_timeline_events_tenant_channel_phone_idx
  on public.conversation_timeline_events ("tenantId", "channelId", "phonePk", "createdAt");

create index if not exists conversation_timeline_events_tenant_channel_conversation_idx
  on public.conversation_timeline_events ("tenantId", "channelId", "chatwootConversationId", "createdAt");
