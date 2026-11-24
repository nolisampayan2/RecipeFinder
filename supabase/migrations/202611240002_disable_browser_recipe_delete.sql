-- RecipeFinder Phase 6C.8B: permanent recipe deletion is not a browser feature.
-- Apply only after checking the target project, migration history, and live ACLs.
begin;

do $preflight$
declare
  privilege_name text;
  account_table text;
  taxonomy_table text;
begin
  if pg_catalog.to_regclass('public.recipes') is null
    or pg_catalog.to_regclass('public.recipe_categories') is null
    or pg_catalog.to_regclass('public.cuisines') is null
    or pg_catalog.to_regclass('public.favorites') is null
    or pg_catalog.to_regclass('public.recipe_collections') is null
    or pg_catalog.to_regclass('public.recipe_collection_items') is null
    or pg_catalog.to_regprocedure(
      'public.list_published_recipe_previews_v1(text,text,integer,integer)'
    ) is null
    or pg_catalog.to_regprocedure('public.current_user_is_admin()') is null
  then
    raise exception 'Required RecipeFinder tables or RPCs are missing';
  end if;

  if (select relation.relrowsecurity
      from pg_catalog.pg_class as relation
      where relation.oid = 'public.recipes'::pg_catalog.regclass
     ) is distinct from true
    or (select pg_catalog.count(*)
        from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'recipes'
          and policy.policyname in (
            'recipes_read_published', 'recipes_admin_read_all', 'recipes_admin_insert',
            'recipes_admin_update'
          )
       ) <> 4
  then
    raise exception 'Recipe RLS or supported Admin policies differ';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'recipes'
        and policy.policyname = 'recipes_admin_delete'
        and policy.cmd = 'DELETE'
     ) <> 1
    or exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'recipes'
        and policy.cmd in ('DELETE', 'ALL')
        and policy.policyname <> 'recipes_admin_delete'
    )
  then
    raise exception 'Recipe DELETE policies differ from the reviewed baseline';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.recipes', 'DELETE')
      is distinct from true
    or pg_catalog.has_table_privilege('anon', 'public.recipes', 'DELETE')
      is not false
    or pg_catalog.has_table_privilege('anon', 'public.recipes', 'TRUNCATE')
      is not false
    or pg_catalog.has_table_privilege('authenticated', 'public.recipes', 'TRUNCATE')
      is not false
  then
    raise exception 'Browser recipe deletion privileges differ';
  end if;

  foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if pg_catalog.has_table_privilege('authenticated', 'public.recipes', privilege_name)
      is distinct from true then
      raise exception 'Authenticated recipe privilege % is unavailable', privilege_name;
    end if;
  end loop;

  if pg_catalog.has_column_privilege('anon', 'public.recipes', 'id', 'SELECT')
      is distinct from true
    or pg_catalog.has_column_privilege('anon', 'public.recipes', 'name', 'SELECT')
      is distinct from true
    or pg_catalog.has_function_privilege(
      'anon', 'public.list_published_recipe_previews_v1(text,text,integer,integer)', 'EXECUTE'
    ) is distinct from true
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.current_user_is_admin()', 'EXECUTE'
    ) is distinct from true
  then
    raise exception 'Preview or Admin role RPC access is unavailable';
  end if;

  foreach privilege_name in array array['ingredients', 'instructions', 'tutorial_url'] loop
    if pg_catalog.has_column_privilege(
      'anon', 'public.recipes', privilege_name, 'SELECT'
    ) is not false
      or pg_catalog.has_column_privilege(
        'authenticated', 'public.recipes', privilege_name, 'SELECT'
      ) is distinct from true then
      raise exception 'Protected recipe column access differs: %', privilege_name;
    end if;
  end loop;

  foreach taxonomy_table in array array['public.recipe_categories', 'public.cuisines'] loop
    foreach privilege_name in array array['id', 'name', 'is_active'] loop
      if pg_catalog.has_column_privilege('anon', taxonomy_table, privilege_name, 'SELECT')
        is distinct from true then
        raise exception 'Anonymous preview taxonomy access differs: %', taxonomy_table;
      end if;
    end loop;
  end loop;

  foreach account_table in array array[
    'public.favorites', 'public.recipe_collections', 'public.recipe_collection_items'
  ] loop
    if (select relation.relrowsecurity
        from pg_catalog.pg_class as relation
        where relation.oid = account_table::pg_catalog.regclass
       ) is distinct from true then
      raise exception 'Account-data RLS is disabled: %', account_table;
    end if;
    foreach privilege_name in array array['SELECT', 'INSERT', 'DELETE'] loop
      if pg_catalog.has_table_privilege('authenticated', account_table, privilege_name)
        is distinct from true then
        raise exception 'Account-data privilege % is unavailable: %', privilege_name, account_table;
      end if;
    end loop;
  end loop;
  if pg_catalog.has_column_privilege(
    'authenticated', 'public.recipe_collections', 'name', 'UPDATE'
  ) is distinct from true then
    raise exception 'Collection rename privilege is unavailable';
  end if;
end;
$preflight$;

revoke delete on table public.recipes from public, anon, authenticated;
drop policy recipes_admin_delete on public.recipes;

do $verify$
declare
  privilege_name text;
  account_table text;
  taxonomy_table text;
begin
  if pg_catalog.has_table_privilege('anon', 'public.recipes', 'DELETE')
      is not false
    or pg_catalog.has_table_privilege('authenticated', 'public.recipes', 'DELETE')
      is not false
    or pg_catalog.has_table_privilege('anon', 'public.recipes', 'TRUNCATE')
      is not false
    or pg_catalog.has_table_privilege('authenticated', 'public.recipes', 'TRUNCATE')
      is not false
    or exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'recipes'
        and policy.cmd in ('DELETE', 'ALL')
    )
  then
    raise exception 'Browser recipe deletion remains possible';
  end if;

  if (select relation.relrowsecurity
      from pg_catalog.pg_class as relation
      where relation.oid = 'public.recipes'::pg_catalog.regclass
     ) is distinct from true
    or (select pg_catalog.count(*)
        from pg_catalog.pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'recipes'
          and policy.policyname in (
            'recipes_read_published', 'recipes_admin_read_all', 'recipes_admin_insert',
            'recipes_admin_update'
          )
       ) <> 4
  then
    raise exception 'Supported recipe RLS policies changed';
  end if;

  foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if pg_catalog.has_table_privilege('authenticated', 'public.recipes', privilege_name)
      is distinct from true then
      raise exception 'Authenticated recipe privilege % changed', privilege_name;
    end if;
  end loop;

  if pg_catalog.has_column_privilege('anon', 'public.recipes', 'id', 'SELECT')
      is distinct from true
    or pg_catalog.has_column_privilege('anon', 'public.recipes', 'name', 'SELECT')
      is distinct from true
    or pg_catalog.has_function_privilege(
      'anon', 'public.list_published_recipe_previews_v1(text,text,integer,integer)', 'EXECUTE'
    ) is distinct from true
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.current_user_is_admin()', 'EXECUTE'
    ) is distinct from true
  then
    raise exception 'Preview or Admin role RPC access changed';
  end if;

  foreach privilege_name in array array['ingredients', 'instructions', 'tutorial_url'] loop
    if pg_catalog.has_column_privilege(
      'anon', 'public.recipes', privilege_name, 'SELECT'
    ) is not false
      or pg_catalog.has_column_privilege(
        'authenticated', 'public.recipes', privilege_name, 'SELECT'
      ) is distinct from true then
      raise exception 'Protected recipe column access changed: %', privilege_name;
    end if;
  end loop;

  foreach taxonomy_table in array array['public.recipe_categories', 'public.cuisines'] loop
    foreach privilege_name in array array['id', 'name', 'is_active'] loop
      if pg_catalog.has_column_privilege('anon', taxonomy_table, privilege_name, 'SELECT')
        is distinct from true then
        raise exception 'Anonymous preview taxonomy access changed: %', taxonomy_table;
      end if;
    end loop;
  end loop;

  foreach account_table in array array[
    'public.favorites', 'public.recipe_collections', 'public.recipe_collection_items'
  ] loop
    if (select relation.relrowsecurity
        from pg_catalog.pg_class as relation
        where relation.oid = account_table::pg_catalog.regclass
       ) is distinct from true then
      raise exception 'Account-data RLS changed: %', account_table;
    end if;
    foreach privilege_name in array array['SELECT', 'INSERT', 'DELETE'] loop
      if pg_catalog.has_table_privilege('authenticated', account_table, privilege_name)
        is distinct from true then
        raise exception 'Account-data privilege % changed: %', privilege_name, account_table;
      end if;
    end loop;
  end loop;
  if pg_catalog.has_column_privilege(
    'authenticated', 'public.recipe_collections', 'name', 'UPDATE'
  ) is distinct from true then
    raise exception 'Collection rename privilege changed';
  end if;
end;
$verify$;

commit;
