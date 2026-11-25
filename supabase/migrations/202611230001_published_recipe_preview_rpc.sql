-- RecipeFinder Option B: safe public preview contract.
-- This additive RPC does not change table grants, RLS policies, or recipe data.

begin;

create or replace function public.list_published_recipe_previews_v1(
  p_search text default null,
  p_filter text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id text,
  name text,
  description text,
  category text,
  cuisine text,
  image_url text,
  fallback_image_url text,
  source_type text,
  external_provider text,
  external_id text
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  -- ECMAScript String.trim WhiteSpace and LineTerminator code points.
  js_trim_characters constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  normalized_search text;
  normalized_filter text;
begin
  normalized_search := nullif(btrim(coalesce(p_search, ''), js_trim_characters), '');
  normalized_filter := nullif(btrim(coalesce(p_filter, ''), js_trim_characters), '');

  if p_limit is null or p_limit < 1 or p_limit > 51
    or p_offset is null or p_offset < 0 or p_offset > 10000
    or char_length(coalesce(normalized_search, '')) > 100
    or char_length(coalesce(normalized_filter, '')) > 80
    or coalesce(normalized_search, '') ~ '[[:cntrl:]]'
    or coalesce(normalized_filter, '') ~ '[[:cntrl:]]'
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid recipe preview request';
  end if;

  return query
  select
    recipe.id,
    recipe.name,
    recipe.description,
    category_row.name,
    cuisine_row.name,
    recipe.image_url,
    recipe.fallback_image_url,
    recipe.source_type,
    recipe.external_provider,
    recipe.external_id
  from public.recipes as recipe
  join public.recipe_categories as category_row
    on category_row.id = recipe.category_id
   and category_row.is_active
  join public.cuisines as cuisine_row
    on cuisine_row.id = recipe.cuisine_id
   and cuisine_row.is_active
  where recipe.status = 'published'
    and btrim(recipe.name, js_trim_characters) <> ''
    and btrim(recipe.description, js_trim_characters) <> ''
    and btrim(category_row.name, js_trim_characters) <> ''
    and btrim(cuisine_row.name, js_trim_characters) <> ''
    and recipe.name !~ '[[:cntrl:]]'
    and recipe.description !~ '[[:cntrl:]]'
    and category_row.name !~ '[[:cntrl:]]'
    and cuisine_row.name !~ '[[:cntrl:]]'
    and (
      (
        recipe.source_type in ('seed', 'cms')
        and recipe.id ~ '^[a-z0-9][a-z0-9:_-]{0,199}$'
        and recipe.id not like 'external:%'
        and recipe.external_provider is null
        and recipe.external_id is null
      )
      or (
        recipe.source_type = 'external'
        and recipe.external_provider = 'fictional-offline'
        and recipe.external_id ~ '^[0-9]+$'
        and recipe.id = 'external:fictional-offline:' || recipe.external_id
      )
    )
    and (
      normalized_search is null
      or pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.concat_ws(
          ' ', recipe.name, recipe.description, category_row.name, cuisine_row.name
        )),
        pg_catalog.lower(normalized_search)
      ) > 0
    )
    and (
      normalized_filter is null
      or pg_catalog.lower(category_row.name) = pg_catalog.lower(normalized_filter)
      or pg_catalog.lower(cuisine_row.name) = pg_catalog.lower(normalized_filter)
    )
  order by pg_catalog.lower(recipe.name) collate "C", recipe.id collate "C"
  limit p_limit
  offset p_offset;
end;
$function$;

revoke all on function public.list_published_recipe_previews_v1(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_published_recipe_previews_v1(text, text, integer, integer)
  to anon, authenticated;

comment on function public.list_published_recipe_previews_v1(text, text, integer, integer) is
  'Returns a bounded, safe preview of published RecipeFinder recipes; search is literal and case-insensitive.';

commit;
