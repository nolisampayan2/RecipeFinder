# Option B production migration path

These files are preparation only. Do not run migrations automatically against an
uninspected project. Confirm the project reference, backup, schema, effective
grants, RLS, taxonomy, existing recipe IDs, and migration history first.

The disposable `recipefinder-testing` project received the original 16-recipe
detail migration manually. Its byte-for-byte source is archived at
`supabase/testing-migrations/202611230002_recipe_detail_seed_data.sql`.
That file is outside the executable migrations directory and must never run in
production. The production migration at the same version path
`supabase/migrations/202611230002_recipe_detail_seed_data.sql` contains only
the ten original owned recipes. These are different histories; do not apply
the production variant to the testing project or mark it applied there. If a
project records version `202611230002` or has any of the six fictional recipes,
stop and reconcile its history and data before proceeding.

For a fresh, separately verified production schema, the dependency order is:

1. `202610270001_recipefinder_foundation.sql`
2. `202611030001_admin_access_rpc.sql`
3. `202611230001_published_recipe_preview_rpc.sql`
4. `202611230002_recipe_detail_seed_data.sql` (production ten-recipe variant)
5. `202611240001_recipe_collections.sql`
6. `202611240002_disable_browser_recipe_delete.sql`

Apply only missing migrations after checking the actual target. Step 4 requires
the old recipe DELETE grant and policy; step 6 removes them. The production
detail migration restricts anonymous detail columns and inserts missing seed
rows in one transaction. It verifies already-present seed rows exactly and
aborts on conflicts. Existing CMS rows, accounts, Favorites, and Collections
are not rewritten. The eight required categories and eight cuisines must be
present and match their reviewed names before step 4. `supabase/seed.sql` is
not a release migration; its upsert behavior must not be run blindly.

The production application build is separate from these database steps.
Before cutover, inspect the generated Production artifact for legacy recipe
details, fictional test fixtures, and Admin CMS files. Verify authenticated
details, anonymous denial, registration, password recovery, Favorites,
Collections, and public TheMealDB behavior with real browser sessions.
Preserve restricted database permissions if frontend rollback is needed.
