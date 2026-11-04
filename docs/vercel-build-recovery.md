# Vercel static-build recovery

The static build fails closed when it cannot prove that cleanup completed or
that the build lock still belongs to the current process. A cleanup error may
therefore leave a lock or temporary directory for manual review.

If the initial metadata check fails immediately after exclusive lock creation,
the build intentionally closes the acquired handle without unlinking the lock
pathname. This avoids deleting a replacement lock on filesystems where pathname
identity cannot be proven reliably after the handle is closed.

Use this recovery procedure only from the RecipeFinder project root:

1. Confirm that no RecipeFinder static-build process is running.
2. Resolve and verify that the lock path is exactly
   `PROJECT_ROOT/.dist-build-lock`.
3. Inspect that exact path and confirm it is an ordinary file, not a symbolic
   link, junction, directory, or other filesystem object.
4. Only after those checks, remove that exact lock file. If its identity or
   ownership is uncertain, preserve it and investigate instead.
5. Inspect each `PROJECT_ROOT/.dist-build-*` temporary directory individually.
   Confirm its resolved parent is the project root and that it is an ordinary
   directory before deciding whether it is safe to remove.
6. Never use wildcard deletion, broad recursive cleanup, `git clean`, or a
   command targeting the project root.
7. Rerun the focused static-build tests, the complete offline suite, JavaScript
   syntax checks, `git diff --check`, and the generated-residue check before
   attempting another build.

Do not automate deletion of an unverified lock or temporary path.

## Admin CMS Preview isolation

The Admin CMS is excluded from ordinary, Development, and Production builds.
Its six static files are included only when both build variables match exactly:

```text
VERCEL_ENV=preview
ENABLE_ADMIN_CMS_PREVIEW=true
```

Scope `ENABLE_ADMIN_CMS_PREVIEW` to the Vercel Preview environment only. It is
not a secret and must never contain credentials, user identifiers, or role
information. The build also requires Vercel's own `VERCEL_ENV` value to be
`preview`, so setting the flag in Production does not enable the Admin route.

Before a supervised Preview deployment, run the offline static-build tests and
confirm that the Preview inventory adds exactly `admin.html`, `admin.css`, and
the four Admin-only JavaScript modules. Confirm separately that a Production
build retains the original public-only inventory.

To disable the Preview Admin route, remove `ENABLE_ADMIN_CMS_PREVIEW` or set it
to any value other than the exact lowercase string `true`, then perform a
separately authorized Preview rebuild. Verify that `admin.html` and all five
other Admin-only files are absent from the generated inventory. This does not
revoke an administrator role or change Supabase.
