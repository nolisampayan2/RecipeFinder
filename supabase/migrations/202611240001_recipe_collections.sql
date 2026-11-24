-- Option B Collections draft. Do not apply before the coordinated recipe-detail
-- restriction and seed migration (202611230002) is verified and applied safely.
begin;

create table public.recipe_collections (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint recipe_collections_name_valid check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 80
    and name !~ '[[:cntrl:]]'
  )
);

create unique index recipe_collections_owner_name_uidx
  on public.recipe_collections (user_id, pg_catalog.lower(name));
create index recipe_collections_owner_created_idx
  on public.recipe_collections (user_id, created_at, id);

create table public.recipe_collection_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  collection_id uuid not null references public.recipe_collections (id) on delete cascade,
  recipe_id text references public.recipes (id) on delete cascade,
  mealdb_id text,
  created_at timestamptz not null default now(),
  constraint recipe_collection_items_one_source check (
    (recipe_id is not null and mealdb_id is null)
    or (recipe_id is null and mealdb_id is not null)
  ),
  constraint recipe_collection_items_mealdb_id_valid check (
    mealdb_id is null or mealdb_id ~ '^[0-9]{1,20}$'
  ),
  constraint recipe_collection_items_owned_id_valid check (
    recipe_id is null or (
      recipe_id ~ '^[a-z0-9][a-z0-9:_-]{0,199}$'
      and recipe_id not like 'external:themealdb:%'
    )
  ),
  constraint recipe_collection_items_owned_unique unique (collection_id, recipe_id),
  constraint recipe_collection_items_mealdb_unique unique (collection_id, mealdb_id)
);

create index recipe_collection_items_collection_created_idx
  on public.recipe_collection_items (collection_id, created_at, id);

alter table public.recipe_collections enable row level security;
alter table public.recipe_collection_items enable row level security;

revoke all on table public.recipe_collections from public, anon, authenticated;
revoke all on table public.recipe_collection_items from public, anon, authenticated;
grant select, insert, delete on table public.recipe_collections to authenticated;
grant update (name) on table public.recipe_collections to authenticated;
grant select, insert, delete on table public.recipe_collection_items to authenticated;

create policy recipe_collections_select_own
on public.recipe_collections for select to authenticated
using (user_id = (select auth.uid()));

create policy recipe_collections_insert_own
on public.recipe_collections for insert to authenticated
with check (user_id = (select auth.uid()));

create policy recipe_collections_update_own
on public.recipe_collections for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy recipe_collections_delete_own
on public.recipe_collections for delete to authenticated
using (user_id = (select auth.uid()));

create policy recipe_collection_items_select_own
on public.recipe_collection_items for select to authenticated
using (exists (
  select 1 from public.recipe_collections as collection
  where collection.id = collection_id and collection.user_id = (select auth.uid())
));

create policy recipe_collection_items_insert_own
on public.recipe_collection_items for insert to authenticated
with check (
  exists (
    select 1 from public.recipe_collections as collection
    where collection.id = collection_id and collection.user_id = (select auth.uid())
  )
  and (
    recipe_id is null or exists (
      select 1 from public.recipes as recipe
      where recipe.id = recipe_id and recipe.status = 'published'
        and (
          (recipe.source_type in ('seed', 'cms')
            and recipe.external_provider is null and recipe.external_id is null
            and recipe.id not like 'external:%')
          or (recipe.source_type = 'external'
            and recipe.external_provider = 'fictional-offline'
            and recipe.external_id ~ '^[0-9]+$'
            and recipe.id = 'external:fictional-offline:' || recipe.external_id)
        )
    )
  )
);

create policy recipe_collection_items_delete_own
on public.recipe_collection_items for delete to authenticated
using (exists (
  select 1 from public.recipe_collections as collection
  where collection.id = collection_id and collection.user_id = (select auth.uid())
));

commit;
