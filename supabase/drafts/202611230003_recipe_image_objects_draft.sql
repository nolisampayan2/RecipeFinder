-- ARCHIVED OFFLINE DESIGN FOR PHASE 6. Not approved for migration execution.
-- Kept outside supabase/migrations so migration discovery cannot apply it.
-- Storage bucket semantics, image decoding, and coordinated publication are
-- unverified. This guard makes accidental application fail before any DDL.
begin;
do $blocked$
begin
  raise exception 'Recipe image infrastructure is an unverified offline draft';
end;
$blocked$;

-- Version 003 follows the conditional Option B version 002. A target must be
-- inspected separately for actual migration history and effective privileges.
-- Existing public.recipes columns and manual image URLs are untouched.
-- The redundant unique pair supports a foreign key that permanently pins an
-- image object to CMS provenance, including after later recipe updates.
alter table public.recipes
  add constraint recipes_id_source_type_for_images unique (id, source_type);

create table public.recipe_image_objects (
  id uuid primary key,
  recipe_id text not null,
  recipe_source_type text not null default 'cms' check (recipe_source_type = 'cms'),
  constraint recipe_image_objects_cms_recipe_fk
    foreign key (recipe_id, recipe_source_type)
    references public.recipes (id, source_type) on update restrict on delete restrict,
  kind text not null check (kind in ('draft', 'published')),
  object_path text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  request_id uuid not null unique,
  state text not null check (state in ('pending', 'active', 'retired')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint recipe_image_object_state_times check (
    (state = 'pending' and activated_at is null and retired_at is null)
    or (state = 'active' and activated_at is not null and retired_at is null)
    or (state = 'retired' and retired_at is not null)
  ),
  constraint recipe_image_object_path_owned check (
    left(object_path, char_length('cms/' || recipe_id || '/')) = 'cms/' || recipe_id || '/'
    and substring(object_path from char_length('cms/' || recipe_id || '/') + 1)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  ),
  constraint recipe_image_object_type_path check (
    (content_type = 'image/jpeg' and object_path ~ '[.]jpg$')
    or (content_type = 'image/png' and object_path ~ '[.]png$')
    or (content_type = 'image/webp' and object_path ~ '[.]webp$')
  )
);

create unique index recipe_image_objects_one_active_per_kind
  on public.recipe_image_objects (recipe_id, kind)
  where state = 'active';
create index recipe_image_objects_reconcile
  on public.recipe_image_objects (state, created_at);

create function private.enforce_recipe_image_object()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  recipe_source text;
  recipe_status text;
begin
  select source_type, status into recipe_source, recipe_status
  from public.recipes where id = new.recipe_id for update;
  if recipe_source is distinct from 'cms' or left(new.recipe_id, 9) = 'external:' then
    raise exception 'Recipe image object requires a CMS recipe' using errcode = '23514';
  end if;
  if new.kind = 'published' and recipe_status is distinct from 'published' then
    raise exception 'Published image metadata requires a published recipe' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if row(old.id, old.recipe_id, old.recipe_source_type, old.kind, old.object_path, old.content_sha256,
      old.content_type, old.request_id, old.created_at)
      is distinct from row(new.id, new.recipe_id, new.recipe_source_type, new.kind, new.object_path,
      new.content_sha256, new.content_type, new.request_id, new.created_at) then
      raise exception 'Recipe image object identity is immutable' using errcode = '23514';
    end if;
    if not ((old.state = 'pending' and new.state in ('active', 'retired'))
      or (old.state = 'active' and new.state = 'retired')) then
      raise exception 'Recipe image object state transition is invalid' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_recipe_image_object() from public, anon, authenticated, service_role;
grant execute on function private.enforce_recipe_image_object() to service_role;
create trigger recipe_image_objects_enforce
  before insert or update on public.recipe_image_objects
  for each row execute function private.enforce_recipe_image_object();
create trigger recipe_image_objects_set_updated_at
  before update on public.recipe_image_objects
  for each row execute function private.set_updated_at();

alter table public.recipe_image_objects enable row level security;
revoke all on table public.recipe_image_objects from public, anon, authenticated;
grant select, insert, update, delete on table public.recipe_image_objects to service_role;
create policy recipe_image_objects_server_only
  on public.recipe_image_objects for all to service_role
  using (true) with check (true);

comment on table public.recipe_image_objects is
  'Offline draft for immutable CMS image versions. Not a Storage policy or publication coordinator.';
commit;
