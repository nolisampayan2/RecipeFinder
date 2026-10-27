# RecipeFinder database foundation review

Phase 2B creates local design files only. Nothing in this directory has been applied to a database.

## Intended order

1. Review `migrations/202610270001_recipefinder_foundation.sql`.
2. In a later approved batch, apply it to a disposable/local Supabase environment first.
3. Run the RLS and negative-security tests described below.
4. Apply `seed.sql` once as initial setup only, after the foundation migration succeeds.
5. Verify 8 categories, 8 cuisines, and 10 published recipes before any frontend integration.

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

`private.handle_new_user()` and `private.is_admin()` are `SECURITY DEFINER` functions. They use an empty search path and fully qualified object names. They must remain owned by the trusted migration owner. Do not transfer ownership to a login role or grant public execution. The signup trigger must be tested in a disposable environment because any trigger failure can block user creation.

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

These cases must be executed against a disposable/local Supabase project before remote use:

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
