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
