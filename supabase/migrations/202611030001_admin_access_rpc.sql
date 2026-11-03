-- RecipeFinder Phase 3B: boolean-only browser admin verification.
-- This forward migration exposes no role rows or user identifiers.

begin;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_admin();
$$;

revoke all on function public.current_user_is_admin() from public, anon, authenticated, service_role;
grant execute on function public.current_user_is_admin() to authenticated;

comment on function public.current_user_is_admin() is
  'Returns only whether the authenticated caller has the server-managed admin role. RLS remains authoritative.';

commit;
