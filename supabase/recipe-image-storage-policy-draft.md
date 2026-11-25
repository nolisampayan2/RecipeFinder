# Recipe image Storage policy draft — deferred to Phase 6

The image selection foundation is complete but inactive. This document and
`supabase/drafts/202611230003_recipe_image_objects_draft.sql` preserve the
unfinished image persistence design for Phase 6. The SQL remains outside the
executable migrations directory and retains its fail-closed guard. Neither
draft is approved for execution. Existing manual image URL behavior is
unchanged, and no image uploader is active.

Storage infrastructure remains incomplete. Trusted image decoding and
publication coordination are unresolved. This is an offline design, not an
executable Storage migration. No local
Supabase CLI, Deno runtime, PostgreSQL runtime, verified image decoder, or
verified Storage catalog metadata was available during Batch A. Do not create
buckets or apply policies based on this document alone.

## Proposed buckets

| Bucket | Visibility | Intended objects | Browser writes |
| --- | --- | --- | --- |
| `recipe-draft-images` | Private | Verified CMS draft images | None |
| `recipe-published-images` | Public | Immutable images copied only after confirmed recipe publication | None |

Both buckets are proposed to allow `image/jpeg`, `image/png`, and `image/webp`
with a 5 MiB object limit. The trusted server must additionally decode and
validate image bytes and dimensions (at most 4096 by 4096 pixels) before any
private upload or public copy. MIME metadata and extension checks alone do not
prove image content. Public-bucket reads do not become private because a
`storage.objects` policy or recipe RLS checks the recipe status. Never put a
draft object in the public bucket.

## Proposed permission matrix

| Actor | Private draft bucket | Public published bucket | Image-state table |
| --- | --- | --- | --- |
| `anon` | No SELECT/INSERT/UPDATE/DELETE | Public object read only; no writes | No privileges |
| Ordinary `authenticated` | No SELECT/INSERT/UPDATE/DELETE | Public object read only; no writes | No privileges |
| Admin browser | No direct Storage writes, overwrite, delete, or object listing; obtain a short-lived private preview through a trusted operation | Public read only; no direct publication or deletion | No direct privileges |
| Trusted server | Narrow object read/insert/delete after verified user and CMS association; no object overwrite | Insert immutable copy after confirmed publication, reconcile retired copies; no overwrite | Service-only mutations |

The service-role credential must exist only in the trusted server environment.
The server must authenticate the caller and recheck the server-managed Admin
role from `public.user_roles` or the verified user-context Admin RPC. Browser
metadata, a local authorization flag, and a bucket path are not authorization.
The server generates `cms/<recipe-id>/<random-version>.<extension>` paths and
never accepts a caller-supplied bucket, object key, recipe owner, or public URL.
The image-state table records the recipe association and request ID. It is not
a substitute for effective Storage policy tests.

## Publication order and coordination blocker

The existing browser status mutation can directly change `status` and
`published_at` under the repository's broad authenticated UPDATE grant. It
cannot coordinate a Storage copy and recipe-row update atomically. Before
upload-backed publication is activated, a separately reviewed database guard
or narrowed column grants and a trusted status operation must prevent direct
status changes from bypassing image coordination.

To avoid a public object before successful publication, the trusted operation
must first commit the CMS recipe's Published state with a safe placeholder
image URL, read back the committed state, then copy a validated private image
to the public bucket. The public URL and active image-state reference must be
committed together with an expected recipe version check. A failure after the
first commit leaves a published recipe with a placeholder; it must be reported
as partial and retried or reconciled. A copy before the first commit would
expose a still-draft image. No Storage copy and PostgreSQL transaction are
atomic together. Unpublishing or replacing during promotion must serialize on
the recipe row and invalidate the operation before public reference commit.

Immutable paths, unique request IDs, content hashes, and expected row versions
support idempotent retries. Pending or retired objects require age-gated,
reference-aware reconciliation. Never delete a currently referenced object or
an unrelated built-in, external, or shared image. Cached public bytes cannot
be guaranteed private again after unpublishing.

## Required evidence before executable policies or function code

1. Verify actual target migration history, including conditional migration
   `202611230002`, and effective recipe grants and RLS. Repository SQL is not
   evidence that a live target applied it.
2. Verify current official Supabase Storage catalog, bucket limits, public
   retrieval semantics, policy syntax, and role grants in an isolated project.
3. Verify the selected trusted runtime can enforce a 5 MiB request limit,
   robustly decode/re-encode JPEG/PNG/WebP, reject malicious or oversized
   dimensions, and access only server-side credentials. No such runtime was
   locally available in Batch A.
4. Test `anon`, ordinary authenticated, Admin, and server effective privileges
   against both buckets and the image-state table. Test direct overwrite,
   cross-recipe paths, arbitrary deletion, and object listing.
5. Test concurrent Save, Publish, Unpublish, replacement, retry, ambiguous
   responses, partial publication, and cleanup against disposable Storage and
   PostgreSQL. Static SQL inspection and fake services cannot prove these.

No Storage policy SQL, trusted upload function, publication coordinator, or
browser adapter is supplied. Image uploader completion is explicitly deferred
to Phase 6. Do not activate the inactive image selection component or alter
the existing manual URL workflow.
