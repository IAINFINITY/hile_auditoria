-- Auth hardening: allowlist + roles + audit events
-- Contexto A (acesso restrito): somente usuarios cadastrados em allowed_users entram no painel.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_auth_role') THEN
    CREATE TYPE public.app_auth_role AS ENUM ('superadmin', 'admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.allowed_users (
  id text PRIMARY KEY,
  email text NOT NULL,
  supabase_user_id text NULL,
  display_name text NULL,
  role public.app_auth_role NOT NULL DEFAULT 'admin',
  active boolean NOT NULL DEFAULT true,
  created_by text NULL,
  last_login_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_allowed_users_email_lower
  ON public.allowed_users (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS ux_allowed_users_supabase_user_id
  ON public.allowed_users (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_allowed_users_active_role
  ON public.allowed_users (active, role);

-- Garante apenas 1 superadmin ativo no sistema.
CREATE UNIQUE INDEX IF NOT EXISTS ux_allowed_users_single_active_superadmin
  ON public.allowed_users ((role))
  WHERE role = 'superadmin'::public.app_auth_role AND active = true;

CREATE TABLE IF NOT EXISTS public.auth_audit_events (
  id text PRIMARY KEY,
  tenant_id text NULL,
  actor_user_id text NULL,
  actor_email text NULL,
  actor_role text NULL,
  target_email text NULL,
  event_type text NOT NULL,
  outcome text NOT NULL,
  reason text NULL,
  ip text NULL,
  user_agent text NULL,
  request_path text NULL,
  request_method text NULL,
  details_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_created_at
  ON public.auth_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_event_type_created_at
  ON public.auth_audit_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_actor_email_created_at
  ON public.auth_audit_events (actor_email, created_at DESC);

ALTER TABLE public.allowed_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_audit_events ENABLE ROW LEVEL SECURITY;

-- Leitura minima para o proprio usuario autenticado via email do JWT.
DROP POLICY IF EXISTS allowed_users_read_own_active ON public.allowed_users;
CREATE POLICY allowed_users_read_own_active
ON public.allowed_users
FOR SELECT
TO authenticated
USING (
  active = true
  AND lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
);

REVOKE ALL ON TABLE public.auth_audit_events FROM anon, authenticated;

-- Bootstrap fixo do superadmin.
INSERT INTO public.allowed_users (
  id,
  email,
  role,
  active,
  created_by,
  created_at,
  updated_at
)
SELECT
  'bootstrap-superadmin-contato-hile-com',
  'contato@hile.com.br',
  'superadmin'::public.app_auth_role,
  true,
  'bootstrap_sql',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.allowed_users u
  WHERE lower(u.email) = lower('contato@hile.com.br')
);
