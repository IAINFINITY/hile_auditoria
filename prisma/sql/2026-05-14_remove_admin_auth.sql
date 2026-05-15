-- Remove legacy admin-whitelist auth artifacts.
-- New auth model: authenticated Supabase user == authorized app user.

drop function if exists public.is_admin_user();
drop function if exists public.touch_admin_users_updated_at();

drop table if exists public.admin_users;
