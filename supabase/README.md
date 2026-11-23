# RecipeFinder database foundation review

Phase 2B creates local design files only. Nothing in this directory has been applied to a database.

## Batch 6B.4 shared-project authentication readiness runbook

RecipeFinder uses one existing Supabase Free project for controlled development
testing and eventual production. Treat that project as production-sensitive and
potentially nonempty. Do not infer emptiness from dashboard estimates, project
age, or the absence of known users. This runbook does not authorize configuration
changes, email delivery, SQL execution, account creation, deployment, or real
Auth calls.

### Current evidence boundary

RecipeFinder's registration, login, email-confirmation callback, dashboard
session restoration, and local logout entrypoints are connected in the browser.
They have deterministic offline coverage using injected fake clients. The tests
cover strict response envelopes, mandatory confirmed-email evidence, PKCE
callback parsing and URL scrubbing, temporary-session containment, session
expiry, Auth-event ordering, duplicate operations, error redaction, and cleanup.

The following remain **not verified with a real provider**: public project
configuration, email delivery and templates, redirect allowlisting, PKCE
verifier continuity, browser storage and token refresh, multi-tab behavior,
hosted routing, rate limits, migration compatibility, signup-trigger execution,
seed behavior, grants, RLS, and administrative provisioning.

### Authorization gates

Stop and obtain explicit approval before each inspection or state-changing stage:

1. Inspect the selected shared project's catalog using only the separately
   approved read-only queries below.
2. Change Auth, email, URL, or rate-limit settings.
3. Create a local public configuration file or configure deployment variables.
4. Apply the foundation migration or seed.
5. Create accounts, send email, exchange a real code, sign in, or sign out.
6. Provision an administrator or run database security tests.
7. Create a Vercel Preview or any other deployment.

Do not combine these gates into one implied authorization.

### Shared-project safety checklist

- [ ] Confirm the exact project reference outside the repository without recording
      credentials, keys, connection strings, or personal information.
- [ ] Treat all existing schemas, objects, Auth identities, and rows as data that
      must be preserved until an authorized inspection proves otherwise.
- [ ] Confirm the operator is using a read-only inspection session where the
      Supabase interface supports it; otherwise review every statement before use.
- [ ] Capture a verified backup before any later schema or data change.
- [ ] Use only a project URL and a browser-safe publishable/anon key in the frontend.
- [ ] Never expose a secret key, `service_role` key, JWT secret, database password,
      management token, SMTP credential, or trusted SQL connection string.
- [ ] Enable mandatory email confirmation before the first registration test.
- [ ] Keep automatic post-signup authentication disabled; RecipeFinder expects a
      null signup session and requires manual login after confirmation.
- [ ] Review email-template links, expiry, resend cooldowns, and Auth rate limits.
- [ ] Configure exact redirect URLs only. Do not add wildcard origins for convenience.
- [ ] Do not delete, reset, pause, restore, or repurpose the shared project as part
      of inspection.

### Read-only catalog inspection gate

The queries in this section are preparation material only. **Do not execute them
without separate authorization.** They are intentionally limited to `SELECT` and
return catalog metadata, aggregate counts, or known non-personal identifiers. Do
not add queries that return rows from `auth.users`, `auth.identities`, profiles,
Favorites, sessions, audit logs, or storage objects. Never select email addresses,
phone numbers, passwords, password hashes, tokens, JWTs, session data, provider
metadata, confirmation links, IP addresses, or user metadata.

Before inspecting, verify the selected project independently. Save only sanitized
results: object names, owners, grants, policy definitions, migration versions, and
aggregate counts. Treat unexpected schemas, owners, grants, objects, migrations,
or nonzero counts as a stop condition.

#### 1. Schemas and relation ownership

```sql
select
  n.nspname as schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) as owner_name
from pg_catalog.pg_namespace as n
where n.nspname in ('public', 'private', 'auth', 'supabase_migrations')
order by n.nspname;

select
  n.nspname as schema_name,
  c.relname as relation_name,
  c.relkind as relation_kind,
  pg_catalog.pg_get_userbyid(c.relowner) as owner_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname in ('public', 'private')
  and c.relkind in ('r', 'p', 'v', 'm', 'S')
order by n.nspname, c.relname;
```

#### 2. Columns, constraints, and indexes

```sql
select
  table_schema,
  table_name,
  column_name,
  ordinal_position,
  data_type,
  is_nullable,
  column_default,
  is_identity
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles', 'user_roles', 'recipe_categories',
    'cuisines', 'recipes', 'favorites'
  )
order by table_name, ordinal_position;

select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_catalog.pg_get_constraintdef(con.oid, true) as definition
from pg_catalog.pg_constraint as con
join pg_catalog.pg_class as c on c.oid = con.conrelid
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'user_roles', 'recipe_categories',
    'cuisines', 'recipes', 'favorites'
  )
order by c.relname, con.conname;

select schemaname, tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles', 'user_roles', 'recipe_categories',
    'cuisines', 'recipes', 'favorites'
  )
order by tablename, indexname;
```

#### 3. Functions and triggers

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proconfig as function_settings
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by n.nspname, p.proname, identity_arguments;

select
  ns.nspname as table_schema,
  cls.relname as table_name,
  trg.tgname as trigger_name,
  pg_catalog.pg_get_triggerdef(trg.oid, true) as definition
from pg_catalog.pg_trigger as trg
join pg_catalog.pg_class as cls on cls.oid = trg.tgrelid
join pg_catalog.pg_namespace as ns on ns.oid = cls.relnamespace
where not trg.tgisinternal
  and ns.nspname in ('public', 'auth')
order by ns.nspname, cls.relname, trg.tgname;
```

#### 4. RLS policies and grants

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
order by tablename, policyname;

select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema in ('public', 'private')
order by table_schema, table_name, grantee, privilege_type;

select routine_schema, routine_name, grantee, privilege_type, is_grantable
from information_schema.role_routine_grants
where routine_schema in ('public', 'private')
order by routine_schema, routine_name, grantee, privilege_type;

select object_schema, object_name, object_type, grantee, privilege_type
from information_schema.role_usage_grants
where object_schema in ('public', 'private')
order by object_schema, object_name, grantee, privilege_type;
```

#### 5. Migration history presence

Check for the migration-history relation before querying it:

```sql
select pg_catalog.to_regclass('supabase_migrations.schema_migrations')
  as migration_history_relation;
```

Only if that result confirms the expected relation exists, inspect identifiers
without returning stored SQL bodies:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

If the installed Supabase schema uses different columns, stop and inspect its
catalog definition; do not improvise a query that returns migration statements.

#### 6. Aggregate Auth and application counts

These queries return counts only. They must never be expanded to select identity
rows or contact information.

```sql
select
  count(*) as auth_user_count,
  count(*) filter (where email_confirmed_at is not null) as confirmed_user_count,
  count(*) filter (where email_confirmed_at is null) as unconfirmed_user_count
from auth.users;
```

Run the following only after the relation inventory confirms all six application
tables exist:

```sql
select 'profiles' as relation_name, count(*) as row_count from public.profiles
union all
select 'user_roles', count(*) from public.user_roles
union all
select 'recipe_categories', count(*) from public.recipe_categories
union all
select 'cuisines', count(*) from public.cuisines
union all
select 'recipes', count(*) from public.recipes
union all
select 'favorites', count(*) from public.favorites
order by relation_name;
```

#### 7. Seed collision counts

Run these only if the relevant tables already exist. They return aggregate counts,
not stored content:

```sql
select count(*) as category_slug_collisions
from public.recipe_categories
where slug = any (array[
  'chicken', 'beef', 'seafood', 'pasta',
  'vegetarian', 'dessert', 'breakfast', 'soup'
]);

select count(*) as cuisine_slug_collisions
from public.cuisines
where slug = any (array[
  'italian', 'american', 'british', 'mexican',
  'japanese', 'indian', 'french', 'mediterranean'
]);

select count(*) as recipe_id_collisions
from public.recipes
where id = any (array[
  'creamy-garlic-pasta', 'lemon-chicken', 'beef-stew',
  'fish-tacos', 'chocolate-cake', 'garden-salad',
  'tomato-soup', 'vegetable-curry', 'pancakes', 'salmon-bowl'
]);
```

Any collision means `seed.sql` is unsafe to run without a separately audited data
plan. A zero collision count is not by itself seed authorization; backup and all
other gates still apply.

### Compatibility decision gate

After a separately authorized inspection, independently review the sanitized
results against `202610270001_recipefinder_foundation.sql`:

- **Genuinely empty and compatible:** no overlapping RecipeFinder objects, no
  application rows, no existing Auth users requiring backfill, expected trusted
  owners, and no conflicting migration history. Re-audit the original foundation
  migration for this exact project before separately authorizing execution.
- **Overlapping objects, migrations, rows, or Auth users:** do not run the original
  fresh-project migration. Prepare a forward-compatible, idempotent migration and
  any non-destructive profile/default-role backfill as a new independently audited
  batch. Never overwrite an existing role.
- **Uncertain or incomplete evidence:** remain blocked. Do not infer compatibility.

`seed.sql` remains prohibited until a verified backup exists, collision checks are
zero or an explicit preservation plan is approved, the schema migration and real
RLS tests pass, and seed execution receives separate authorization.

### Exact localhost routes

Use the hostname `localhost`; do not switch to `127.0.0.1`, another hostname,
HTTPS, a different port, or a different path during the PKCE round trip.

| Purpose | Exact URL |
| --- | --- |
| Application/Site URL candidate | `http://localhost/RecipeFinder/` |
| Registration | `http://localhost/RecipeFinder/register.html` |
| Email-confirmation callback | `http://localhost/RecipeFinder/auth-callback.html` |
| Manual login | `http://localhost/RecipeFinder/login.html` |
| Dashboard | `http://localhost/RecipeFinder/index.html` |

The exact callback URL above must be present in the shared project's Auth
redirect allowlist. It must not contain credentials, a query string, or a
fragment when configured. Supabase adds the one-time callback parameters during
the real flow; RecipeFinder captures and scrubs them on arrival.

### Future HTTPS Vercel Preview routes

No Preview hostname is assumed or approved by this document. After a Preview
origin has actually been allocated and separately approved, use one immutable
HTTPS origin consistently:

- `https://<approved-preview-origin>/register.html`
- `https://<approved-preview-origin>/auth-callback.html`
- `https://<approved-preview-origin>/login.html`
- `https://<approved-preview-origin>/index.html`

Replace the placeholder only in the external environment checklist, not with a
real hostname committed to this file. The callback must be the exact HTTPS
same-origin `/auth-callback.html` route. Do not allow HTTP, credentials, query
strings, fragments, arbitrary return URLs, branch-wide wildcards, or unrelated
Vercel origins. Verify that direct requests to every `.html` route return the
intended static page before allowing email delivery.

### PKCE browser requirements

- Registration and callback must run in the same browser profile and origin.
- Do not use private browsing, clear site data, change hostnames, or switch
  devices between signup and confirmation; those actions can remove the PKCE
  verifier from persistent browser storage.
- Open the confirmation link in the browser profile that initiated registration.
- Process a callback code once only. Never reuse a captured or previously failed code.
- The callback must scrub sensitive parameters before exchange and must not log,
  copy, screenshot, or retain the authorization code.
- Confirmation success still requires local sign-out of the temporary callback
  session and a separate manual login.

### Public browser configuration policy

For localhost testing, the existing ignored `js/supabase-config.js` contract may
contain only:

```js
export const SUPABASE_CONFIG = Object.freeze({
  url: 'DISPOSABLE_PROJECT_URL',
  publishableKey: 'DISPOSABLE_BROWSER_PUBLISHABLE_KEY',
});
```

Create it from `js/supabase-config.example.js` only after approval. Do not commit
the generated file or paste its values into issues, reports, screenshots, logs,
test fixtures, or chat. Although publishable/anon keys are designed for browser
use, RLS remains the authorization boundary and the values remain environment
specific.

#### Vercel public-configuration generator — implemented offline, not deployed

`scripts/generate-supabase-config.mjs` is the reviewed build-time generator. It
reads `SUPABASE_URL` plus exactly one of `SUPABASE_PUBLISHABLE_KEY` or the legacy
`SUPABASE_ANON_KEY`, validates them with the same browser configuration rules,
and exclusively creates the ignored `js/supabase-config.js` file. It refuses to
overwrite an existing local file and never reads or renders unrelated environment
variables. Run it only in an approved build environment:

```text
node scripts/generate-supabase-config.mjs
```

The generated module is expected to be publicly downloadable by browsers, so it
must contain only the Project URL and publishable/anon key. Vercel environment
scope, build command, output directory, Preview deployment, and callback routes
remain unconfigured and require separate authorization. Do not assume Vercel
environment variables are automatically available to static browser modules.

### Foundation migration prerequisites

- [ ] Complete the shared-project catalog inspection and compatibility decision gate.
- [ ] Confirm the migration targets the expected project and is run by a trusted owner.
- [ ] Review every table, constraint, trigger, function owner, grant, revoke, and policy.
- [ ] Confirm `private.handle_new_user()` remains owned by the trusted migration
      owner, has an empty search path, and is executable only where documented.
- [ ] If Auth users already exist, stop and independently audit a non-destructive
      profile/default-role backfill before any foundation change.
- [ ] Treat any signup-trigger error as a stop condition; do not bypass the trigger.
- [ ] Keep `seed.sql` prohibited until backup, collision checks, migration
      verification, and real RLS negative tests pass.
- [ ] Never run the fresh-project migration directly when overlapping objects,
      migrations, rows, or Auth users exist.

### Signup trigger and RLS verification

After separately authorized migration application and account creation:

- [ ] Exactly one `profiles` row is created for the new Auth user.
- [ ] Exactly one `user_roles` row is created with role `user`.
- [ ] No browser role can assign itself `admin` or mutate `user_roles`.
- [ ] Anonymous access is limited to active taxonomy and published recipes.
- [ ] An authenticated user can read/update only their own permitted profile fields.
- [ ] A user can select, insert, and delete only their own Favorites.
- [ ] Forged user IDs and access to another user's profile or Favorites are rejected.
- [ ] Ordinary users cannot mutate recipes, categories, or cuisines or read drafts.
- [ ] Administrator checks use the server-managed role and retain owner-scoped data rules.
- [ ] Function, table, sequence, and schema privileges match the migration review.
- [ ] Complete all negative tests later in this document before retaining the project.

### Fictional test-account and inbox policy

- Use a dedicated fictional test inbox controlled by the project operator, not a
  personal, school, production, or third-party address.
- Use fictional display names and unique inbox aliases for each scenario, such as
  confirmed, unconfirmed, expired-link, and resend tests.
- Keep the actual address and any provider access details outside the repository.
- Never reuse a password from another account. Store no test password in source,
  documentation, screenshots, logs, browser console output, or issue trackers.
- Delete all test identities and inbox messages during cleanup.

### Controlled real-authentication smoke test

Run one scenario at a time and stop on the first security or configuration failure:

1. Load guest discovery and verify local recipes and local Favorites still work.
2. Open registration and confirm readiness before entering fictional credentials.
3. Submit once; expect pending-confirmation feedback and no authenticated dashboard.
4. Confirm receipt of one email with the exact approved callback origin.
5. Open the link in the initiating browser profile; verify immediate URL scrubbing,
   one PKCE exchange, verified-email evidence, and successful local sign-out.
6. Return to manual login and verify unconfirmed or invalid attempts never navigate.
7. Log in with the confirmed account; verify the fixed dashboard destination and
   sanitized identity display.
8. Refresh the dashboard and verify session restoration, valid expiry, and no raw data.
9. Exercise duplicate tabs and Auth events; verify deterministic session state.
10. Log out locally; verify Guest state, no stale identity, and preserved local Favorites.
11. Test expired, replayed, malformed, and already-consumed callback links safely.
12. Test missing/invalid public configuration and confirm guest discovery remains usable.

Password recovery and Remember Me are not part of this smoke test; their current
controls remain inactive or visual-only.

### Redaction and evidence rules

- Record only scenario name, timestamp, route, expected result, sanitized result,
  and pass/fail status.
- Never record passwords, authorization codes, access tokens, refresh tokens,
  cookies, session objects, JWTs, full email links, provider exceptions, or keys.
- Crop or redact browser screenshots before retention. Keep DevTools storage,
  headers, request bodies, and query parameters out of reports.
- Public UI must use text-only rendering and fixed generic errors.
- A token, credential, or raw provider error in a URL, DOM node, log, screenshot,
  report, or clipboard is an immediate stop condition.

### Stop conditions, rollback, and cleanup

Stop immediately if any of the following occurs:

- The project, origin, callback, key type, browser profile, or database target is uncertain.
- Signup returns an unexpected authenticated session or the temporary session cannot be cleared.
- Email confirmation is bypassed, a callback is replayed, or an unapproved redirect is followed.
- A token, credential, code, session, raw provider error, or another user's data is exposed.
- A migration, trigger, grant, RLS policy, seed, or negative-security test differs from review.
- Guest discovery or local Favorites are modified, uploaded, merged, or deleted.

Rollback for the shared project must be planned before every later change. A
verified logical backup or provider-supported restore path, pre-change catalog and
row counts, a forward remediation plan, and explicit restore authority are
prerequisites. Free-plan capabilities must be confirmed rather than assumed. Stop
browser activity and further writes on any failure; do not delete or reset the
shared project, improvise destructive SQL, weaken RLS, disable the signup trigger,
reuse callback codes, or redirect testing to another environment.

## Intended order

1. Review `migrations/202610270001_recipefinder_foundation.sql`.
2. In a later approved batch, run only the read-only catalog inspection and
   independently review its sanitized results.
3. Choose either the re-audited original migration for a genuinely empty compatible
   project or a separately audited forward-compatible migration.
4. Create and verify a backup before separately authorized schema execution.
5. Run the RLS and negative-security tests described below, including mandatory
   email-confirmation behavior.
6. Consider `seed.sql` only after backup and collision gates pass; otherwise skip it.
7. If seeding is separately approved, verify 8 categories, 8 cuisines, and 10
   published recipes without overwriting existing CMS content.

The foundation migration uses one transaction so schema creation, grants, and RLS policies succeed or fail together. The seed is a separate transaction because reference/sample content has a different review and rerun lifecycle.

## Security model

- Supabase Auth (`auth.users`) owns credentials and identity. No application password or verification-token columns exist.
- `profiles` rows are private and readable/updatable only by their owner.
- `user_roles` has no browser grants or browser RLS policies. A locked `private.is_admin()` function returns only a boolean for RLS decisions.
- Anonymous and authenticated visitors can select published recipes and active categories/cuisines.
- Only authenticated users whose server-managed role is `admin` can see drafts or mutate recipes, categories, and cuisines.
- A published recipe must reference active category and cuisine rows. Database triggers also prevent deactivating taxonomy rows while published recipes reference them.
- Favorites use `(user_id, recipe_id)` as the primary key and are accessible only to the owning user. Ordinary users can insert or see favorites only while the referenced recipe is published; administrators retain access to their own favorites for recipes they are authorized to see as drafts.
- Table and identity-sequence privileges are explicitly revoked from `PUBLIC`, `anon`, and `authenticated` before minimum privileges are granted. Authenticated access to category and cuisine identity sequences is limited to `USAGE`, which is required for administrator inserts through the shared authenticated database role. Profile updates are limited to `display_name` and `avatar_url`. RLS is an additional enforcement layer, not a substitute for grants.
- Seed users and credentials are intentionally absent.

`private.handle_new_user()` and `private.is_admin()` are `SECURITY DEFINER` functions. They use an empty search path and fully qualified object names. They must remain owned by the trusted migration owner. Do not transfer ownership to a login role or grant public execution. The signup trigger must be tested under controlled conditions because any trigger failure can block user creation.

All private helper functions have default `PUBLIC` execution removed. Only roles that require each helper receive explicit schema and function privileges. The taxonomy-integrity triggers use transaction-scoped advisory locks with distinct category and cuisine lock namespaces. This serializes publication against taxonomy deactivation, including concurrent requests. Superusers or migration owners can still bypass application RLS and can disable triggers, so operational access to those roles remains trusted and out of browser scope. Advisory-lock hash collisions can conservatively serialize unrelated writes but do not weaken integrity.

Recipe images accept only constrained `http://` or `https://` URLs, or local paths inside an `assets/` directory. Scheme-relative URLs, other schemes, backslashes, whitespace, control characters, traversal paths, and malformed local paths are rejected. Frontend URL validation remains required because database constraints do not make arbitrary rendering contexts safe.

## Email confirmation requirement

SQL migrations do not enable Supabase email confirmation. In a later authorized configuration batch:

1. Enable mandatory email confirmation in Supabase Auth settings.
2. Configure only allowlisted application redirect URLs for local, Preview, and Production environments.
3. After signup, show a pending-confirmation state rather than normal authenticated features.
4. Treat a session as eligible for profiles, cloud favorites, and admin navigation only after the Auth user reports a confirmed email.
5. Handle callback errors, expired confirmation links, and resend cooldowns without revealing whether unrelated email addresses exist.
6. Never store passwords, confirmation tokens, refresh tokens, or service-role credentials in public tables or browser-managed application data.

Database RLS remains authoritative for data access. Frontend confirmation checks are user-experience controls and must not be treated as a replacement for Auth configuration or RLS.

## Initial admin provisioning

The migration creates no admin account. After an authorized user has registered and confirmed their email, a project owner may provision the first admin through a trusted SQL session:

```sql
begin;

-- Replace this placeholder only in the trusted SQL session. Do not commit it.
-- Confirm the selected UUID belongs to the intended, email-confirmed Auth user.
update public.user_roles
set role = 'admin', updated_at = now()
where user_id = '<AUTH_USER_UUID>'::uuid
returning user_id, role;

commit;
```

The operator must verify that exactly one row is returned. A zero-row result means provisioning did not occur and must not be “fixed” by creating an arbitrary role row. Future admins use the same controlled process or a separately reviewed server-only administration workflow. There is intentionally no browser-accessible role-mutation policy.

## Deterministic seed behavior

- Existing recipe IDs remain text and are preserved exactly for frontend favorite compatibility.
- Ingredients are normalized from frontend tuples to JSON objects with `name` and `measurement` strings.
- All 10 recipes are seeded as `published` with one explicit UTC publication timestamp.
- Existing URLs, descriptions, instructions, fractions, and measurements are preserved.
- Only the existing Creamy Garlic Pasta tutorial URL is seeded.
- Only Hearty Beef Stew receives the existing local fallback image.
- French and Mediterranean have `null` flags because the current frontend does not define flags for them.

The seed uses upserts. It is an initial-setup operation, not a routine deployment migration. Re-running it is structurally idempotent, but it deliberately restores the ten sample recipe rows to their seed content and can overwrite CMS changes. Apply it once to the verified empty/fresh schema, record completion, and do not rerun it after administrators begin editing those records unless that overwrite is explicitly intended.

## Future external recipe IDs

External API integration remains deferred. When it is implemented, frontend-facing recipe IDs must use one centrally generated namespace such as `external:<provider>:<provider-id>`. The provider name must be normalized, and the provider's original identifier must also be stored in `external_provider` and `external_id`. Import code must never derive identity from a recipe title or silently reuse a seed/CMS ID. The existing unique `(external_provider, external_id)` index is a second line of defense; the importer still owns deterministic ID construction and collision handling.

## Negative security tests for the application batch

These cases must be executed against the shared project only after backup, migration
verification, and separate authorization, and before retaining any production data:

1. Anonymous user can read published recipes but cannot read drafts or mutate any table.
2. Ordinary authenticated user cannot read drafts or mutate recipes, categories, or cuisines.
3. Ordinary authenticated user cannot select, insert, update, or delete `user_roles`.
4. User A cannot read, insert, or delete User B's favorites.
5. User A cannot read or update User B's profile.
6. A favorite insert with a forged `user_id` is rejected.
7. An ordinary user cannot insert a favorite for a draft recipe, and an existing favorite is hidden if its recipe is subsequently unpublished; an administrator retains owner-scoped access to their own draft-recipe favorites.
8. An admin can create a draft, read it, publish it with `published_at`, and unpublish it only by clearing `published_at`.
9. An admin cannot delete a category or cuisine still referenced by recipes because those foreign keys use `ON DELETE RESTRICT`.
10. An admin cannot publish a recipe whose category or cuisine is inactive.
11. An admin cannot deactivate a category or cuisine referenced by a published recipe, including a concurrent publication/deactivation attempt.
12. A profile owner can update `display_name` and `avatar_url` but cannot update `id`, `created_at`, or `updated_at` directly.
13. Deleting an Auth user cascades their profile, role, and favorites while retaining authored recipes with `created_by = null`.
14. Deleting a recipe cascades its favorite references.
15. Duplicate external `(external_provider, external_id)` values are rejected.
16. Invalid ingredient JSON, `javascript:`, `data:`, `vbscript:`, protocol-relative URLs, backslashes, whitespace, traversal paths, non-HTTPS tutorial URLs, and inconsistent publication/provenance states are rejected.
17. Catalog inspection confirms no unintended table, sequence, or function privileges remain on `PUBLIC`, `anon`, or ordinary authenticated users.

## Rollback and compatibility limits

- No destructive rollback or `DROP TABLE` script is included. Before production, rollback should be a separately reviewed forward migration or restoration from a verified backup.
- The foundation migration targets a fresh project. It is not generally rerunnable because tables, triggers, policies, and indexes are intentionally created once.
- The seed is rerunnable with the overwrite behavior described above.
- Supabase CLI/PostgreSQL execution was not performed in Phase 2B. SQL must be parser-tested and migration-tested later in an approved local environment.
- External API storage/import semantics remain deferred. The schema reserves namespaced text IDs and external provenance fields without integrating a provider.

## Option B conditional migration 002 draft (not approved for execution)

`migrations/202611230001_published_recipe_preview_rpc.sql` defines the public,
`SECURITY INVOKER` preview contract. The revised
`migrations/202611230002_recipe_detail_seed_data.sql` places restrictive
anonymous recipe grants before its 16 recipe inserts in one transaction. This
source-only draft must **not** be applied automatically or treated as an
authorization to deploy. The earlier negative test allowing anonymous full
recipe reads (item 1 above) describes the foundation state, not the Option B
target state.

Before any separately approved application, verify the exact target's
`supabase_migrations.schema_migrations` history. Version `202611230002` must
be **unapplied**. If it was applied, stop: editing its source will not replay
the restriction, and a separately reviewed forward-only recovery is required.
Verify that migration 001 exists with the reviewed signature, return contract,
`SECURITY INVOKER` behavior, and function ACL. Inspect actual effective
`anon`, `PUBLIC`, inherited-role, and `authenticated` privileges; table and
column grants; RLS policies; exposed views/functions; recipe/taxonomy rows;
and Admin/Favorites dependencies. Repository SQL is not live-state evidence.

PostgreSQL runtime validation in an isolated environment is mandatory before
any shared-project execution. Test grant semantics, the preview RPC as `anon`,
denial of every non-preview recipe column, authenticated details, Admin CMS,
Favorites, collisions, reruns, and transaction rollback. Coordinate compatible
frontend activation and removal of protected details from public JavaScript.
Existing cached bundles and historical deployments require separate handling.

The draft revokes direct `PUBLIC` and `anon` recipe SELECT grants and checks
effective `anon` column privileges before inserting details. An inherited
grant that still exposes a protected column causes the transaction to fail.
Do not repair a failed cutover by restoring anonymous full-detail SELECT;
repair safe preview access with a separately reviewed forward change. This
draft does not authorize Production deployment, SQL execution, or changes to
Supabase settings.
