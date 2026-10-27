-- RecipeFinder Phase 2B: coordinated schema, grants, and RLS foundation.
-- This migration is designed for a fresh Supabase project and must be reviewed
-- before execution. It intentionally contains no credentials or admin user IDs.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.ingredients_are_valid(value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) = 0 then
    return false;
  end if;

  return not exists (
    select 1
    from jsonb_array_elements(value) as ingredient
    where jsonb_typeof(ingredient) <> 'object'
       or jsonb_typeof(ingredient -> 'name') <> 'string'
       or jsonb_typeof(ingredient -> 'measurement') <> 'string'
       or btrim(ingredient ->> 'name') = ''
       or btrim(ingredient ->> 'measurement') = ''
  );
end;
$$;

create or replace function private.is_allowed_recipe_image_url(value text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if value = ''
     or value ~ '[[:space:][:cntrl:]]'
     or position(E'\\' in value) > 0
     or left(value, 2) = '//' then
    return false;
  end if;

  if value ~ '^[A-Za-z][A-Za-z0-9+.-]*:' then
    return value ~ $http$^https?://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]{1,5})?(/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(#[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$http$;
  end if;

  return value ~ $local$^(\./|/([A-Za-z0-9_-]+/)*)?assets/[A-Za-z0-9][A-Za-z0-9._~%-]*(/[A-Za-z0-9][A-Za-z0-9._~%-]*)*$local$;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  constraint profiles_avatar_url_https
    check (avatar_url is null or avatar_url ~ $https$^https://[^[:space:]]+$https$)
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_role_allowed check (role in ('user', 'admin'))
);

create table public.recipe_categories (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  emoji text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_categories_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint recipe_categories_name_not_blank check (char_length(btrim(name)) between 1 and 80)
);

create table public.cuisines (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  flag_emoji text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cuisines_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint cuisines_name_not_blank check (char_length(btrim(name)) between 1 and 80)
);

create table public.recipes (
  id text primary key,
  name text not null,
  description text not null,
  category_id bigint not null references public.recipe_categories (id) on delete restrict,
  cuisine_id bigint not null references public.cuisines (id) on delete restrict,
  image_url text not null,
  fallback_image_url text,
  tutorial_url text,
  ingredients jsonb not null default '[]'::jsonb,
  instructions text not null,
  status text not null default 'draft',
  source_type text not null default 'cms',
  external_provider text,
  external_id text,
  created_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_id_format check (id ~ '^[a-z0-9][a-z0-9:_-]{0,199}$'),
  constraint recipes_name_not_blank check (char_length(btrim(name)) between 1 and 160),
  constraint recipes_description_not_blank check (char_length(btrim(description)) > 0),
  constraint recipes_instructions_not_blank check (char_length(btrim(instructions)) > 0),
  constraint recipes_image_url_allowed check (private.is_allowed_recipe_image_url(image_url)),
  constraint recipes_fallback_image_url_allowed check (
    fallback_image_url is null or private.is_allowed_recipe_image_url(fallback_image_url)
  ),
  constraint recipes_tutorial_url_https check (
    tutorial_url is null or tutorial_url ~ $https$^https://[^[:space:]]+$https$
  ),
  constraint recipes_ingredients_valid check (private.ingredients_are_valid(ingredients)),
  constraint recipes_status_allowed check (status in ('draft', 'published')),
  constraint recipes_publication_state check (
    (status = 'published' and published_at is not null)
    or (status = 'draft' and published_at is null)
  ),
  constraint recipes_source_type_allowed check (source_type in ('seed', 'cms', 'external')),
  constraint recipes_external_identity_consistent check (
    (source_type = 'external'
      and nullif(btrim(external_provider), '') is not null
      and nullif(btrim(external_id), '') is not null)
    or
    (source_type <> 'external' and external_provider is null and external_id is null)
  )
);

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index recipe_categories_active_sort_idx
  on public.recipe_categories (is_active, sort_order, name);
create index cuisines_active_sort_idx
  on public.cuisines (is_active, sort_order, name);
create index recipes_published_idx
  on public.recipes (published_at desc) where status = 'published';
create index recipes_category_idx on public.recipes (category_id);
create index recipes_cuisine_idx on public.recipes (cuisine_id);
create index recipes_created_by_idx on public.recipes (created_by);
create unique index recipes_external_identity_uidx
  on public.recipes (external_provider, external_id)
  where external_provider is not null and external_id is not null;
create index favorites_recipe_idx on public.favorites (recipe_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.ensure_published_recipe_taxonomy_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('recipe-category:' || new.category_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('recipe-cuisine:' || new.cuisine_id::text, 0)
    );

    if not exists (
      select 1
      from public.recipe_categories
      where id = new.category_id and is_active
    ) then
      raise exception using
        errcode = '23514',
        message = 'Published recipes require an active category.';
    end if;

    if not exists (
      select 1
      from public.cuisines
      where id = new.cuisine_id and is_active
    ) then
      raise exception using
        errcode = '23514',
        message = 'Published recipes require an active cuisine.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.prevent_active_category_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('recipe-category:' || new.id::text, 0)
    );

    if exists (
      select 1
      from public.recipes
      where category_id = new.id and status = 'published'
    ) then
      raise exception using
        errcode = '23514',
        message = 'Cannot deactivate a category used by a published recipe.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.prevent_active_cuisine_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('recipe-cuisine:' || new.id::text, 0)
    );

    if exists (
      select 1
      from public.recipes
      where cuisine_id = new.id and status = 'published'
    ) then
      raise exception using
        errcode = '23514',
        message = 'Cannot deactivate a cuisine used by a published recipe.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.ingredients_are_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.is_allowed_recipe_image_url(text) from public, anon, authenticated, service_role;
revoke all on function private.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.ensure_published_recipe_taxonomy_active() from public, anon, authenticated, service_role;
revoke all on function private.prevent_active_category_deactivation() from public, anon, authenticated, service_role;
revoke all on function private.prevent_active_cuisine_deactivation() from public, anon, authenticated, service_role;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger user_roles_set_updated_at
before update on public.user_roles
for each row execute function private.set_updated_at();

create trigger recipe_categories_set_updated_at
before update on public.recipe_categories
for each row execute function private.set_updated_at();

create trigger cuisines_set_updated_at
before update on public.cuisines
for each row execute function private.set_updated_at();

create trigger recipes_set_updated_at
before update on public.recipes
for each row execute function private.set_updated_at();

create trigger recipes_require_active_taxonomy_on_insert
before insert on public.recipes
for each row execute function private.ensure_published_recipe_taxonomy_active();

create trigger recipes_require_active_taxonomy_on_update
before update of category_id, cuisine_id, status on public.recipes
for each row execute function private.ensure_published_recipe_taxonomy_active();

create trigger recipe_categories_prevent_published_deactivation
before update of is_active on public.recipe_categories
for each row execute function private.prevent_active_category_deactivation();

create trigger cuisines_prevent_published_deactivation
before update of is_active on public.cuisines
for each row execute function private.prevent_active_cuisine_deactivation();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant execute on function private.ingredients_are_valid(jsonb) to authenticated, service_role;
grant execute on function private.is_allowed_recipe_image_url(text) to authenticated, service_role;
grant execute on function private.set_updated_at() to authenticated, service_role;
grant execute on function private.ensure_published_recipe_taxonomy_active() to authenticated, service_role;
grant execute on function private.prevent_active_category_deactivation() to authenticated, service_role;
grant execute on function private.prevent_active_cuisine_deactivation() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.recipe_categories enable row level security;
alter table public.cuisines enable row level security;
alter table public.recipes enable row level security;
alter table public.favorites enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.user_roles from public, anon, authenticated;
revoke all on table public.recipe_categories from public, anon, authenticated;
revoke all on table public.cuisines from public, anon, authenticated;
revoke all on table public.recipes from public, anon, authenticated;
revoke all on table public.favorites from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;
grant select on table public.recipe_categories to anon, authenticated;
grant insert, update, delete on table public.recipe_categories to authenticated;
grant select on table public.cuisines to anon, authenticated;
grant insert, update, delete on table public.cuisines to authenticated;
grant select on table public.recipes to anon, authenticated;
grant insert, update, delete on table public.recipes to authenticated;
grant select, insert, delete on table public.favorites to authenticated;
revoke all on sequence public.recipe_categories_id_seq from public, anon, authenticated;
revoke all on sequence public.cuisines_id_seq from public, anon, authenticated;
grant usage on sequence public.recipe_categories_id_seq to authenticated;
grant usage on sequence public.cuisines_id_seq to authenticated;

create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- No anon/authenticated policies or grants exist on user_roles. The narrowly
-- scoped private.is_admin() function is the only browser-request authorization
-- path that reads this table. Role provisioning remains a trusted manual task.

create policy recipe_categories_read_active
on public.recipe_categories for select
to anon, authenticated
using (is_active);

create policy recipe_categories_admin_read_all
on public.recipe_categories for select
to authenticated
using ((select private.is_admin()));

create policy recipe_categories_admin_insert
on public.recipe_categories for insert
to authenticated
with check ((select private.is_admin()));

create policy recipe_categories_admin_update
on public.recipe_categories for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy recipe_categories_admin_delete
on public.recipe_categories for delete
to authenticated
using ((select private.is_admin()));

create policy cuisines_read_active
on public.cuisines for select
to anon, authenticated
using (is_active);

create policy cuisines_admin_read_all
on public.cuisines for select
to authenticated
using ((select private.is_admin()));

create policy cuisines_admin_insert
on public.cuisines for insert
to authenticated
with check ((select private.is_admin()));

create policy cuisines_admin_update
on public.cuisines for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy cuisines_admin_delete
on public.cuisines for delete
to authenticated
using ((select private.is_admin()));

create policy recipes_read_published
on public.recipes for select
to anon, authenticated
using (status = 'published');

create policy recipes_admin_read_all
on public.recipes for select
to authenticated
using ((select private.is_admin()));

create policy recipes_admin_insert
on public.recipes for insert
to authenticated
with check ((select private.is_admin()));

create policy recipes_admin_update
on public.recipes for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy recipes_admin_delete
on public.recipes for delete
to authenticated
using ((select private.is_admin()));

create policy favorites_select_own
on public.favorites for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.recipes as recipe
    where recipe.id = favorites.recipe_id
      and (recipe.status = 'published' or (select private.is_admin()))
  )
);

create policy favorites_insert_own
on public.favorites for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.recipes as recipe
    where recipe.id = favorites.recipe_id
      and (recipe.status = 'published' or (select private.is_admin()))
  )
);

create policy favorites_delete_own
on public.favorites for delete
to authenticated
using ((select auth.uid()) = user_id);

comment on function private.is_admin() is
  'Returns whether auth.uid() has the server-managed admin role. Function owner must remain a trusted migration owner without user-controlled search_path resolution.';
comment on table public.user_roles is
  'Server-managed roles. No browser-accessible role mutation grants or policies are permitted.';

commit;
