# RecipeFinder

RecipeFinder is a web application for discovering, viewing, and organizing recipes. Visitors can browse RecipeFinder recipe previews and search TheMealDB. Registered users can view complete RecipeFinder recipes and maintain personal Favorites and Recipe Collections.

**Live website:** https://recipefinder-pi-ebon.vercel.app/

**Academic project:** Pateros Technological College · Bachelor of Science in Information Technology (BSIT) · Integrative Programming and Technologies

**Group members:**

- [Member name]
- [Member name]
- [Member name]

## Implemented features

- **Recipe discovery:** Search and browse RecipeFinder recipes by category and cuisine.
- **Online Recipes:** Search TheMealDB and view its public recipe details with source attribution.
- **Accounts:** Register, confirm an email address, sign in, sign out, and recover a password.
- **Recipe details:** Guests can view RecipeFinder previews; signed-in users can view complete ingredients and cooking instructions.
- **My Favorites:** Guests can save favorites in their browser. Signed-in users can save supported RecipeFinder recipes to their accounts.
- **My Recipe Collections:** Signed-in users can create, rename, and delete collections and add or remove RecipeFinder and TheMealDB recipes.
- **Admin Dashboard:** Verified administrators can create and edit CMS recipes and publish or unpublish them.
- **Responsive interface:** Desktop and mobile layouts, light and dark themes, and keyboard-accessible controls.

## Technology stack

| Area | Technology |
| --- | --- |
| Interface | HTML, CSS, and JavaScript modules |
| Authentication and database | Supabase Auth and PostgreSQL |
| Access control | PostgreSQL grants and row-level security |
| External recipes | TheMealDB REST API |
| Hosting and build | Vercel static deployment and Node.js build scripts |

## System architecture

The browser requests public recipe previews and TheMealDB results. Supabase Auth manages account sessions. Database permissions and row-level security protect complete RecipeFinder recipe details and each account's Favorites and Collections. The Admin Dashboard checks the user's administrator role; including its files in a build does not grant administrator access.

The Production build selects the files needed by the live application and excludes legacy bundled recipe details and test fixtures.

## Repository structure

```text
assets/       Images and application icon
js/           Browser modules for recipes, accounts, Collections, and Admin
scripts/      Static build and public configuration scripts
supabase/     Database migrations and setup guidance
tests/        Offline automated tests
index.html    Main application page
admin.html    Administrator interface
*.html        Sign-in, registration, confirmation, and recovery pages
styles.css    Main application styles
admin.css     Administrator interface styles
vercel.json   Vercel build configuration
```

## Local development or independent deployment

These steps are for someone setting up **their own environment**; the live RecipeFinder website is already configured.

1. Install Node.js and obtain a separate Supabase project.
2. Review the database migrations, required category and cuisine data, and migration order before applying changes to that project. Do not run seed data against an existing database without checking its contents.
3. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the build environment. Use only a browser-safe publishable key. Do not commit local configuration, database passwords, or privileged keys.
4. Configure the project's Auth Site URL and exact email-confirmation and password-reset redirect URLs for the chosen site origin.
5. Run the build command specified in `vercel.json` and serve the generated `dist/` directory through an HTTP server.
6. An independent Production build includes the Admin Dashboard only when `VERCEL_ENV=production` and `ENABLE_ADMIN_CMS_PRODUCTION=true`. Supabase authorization and database policies remain required.

## Security and access control

In the deployed application, guests can browse previews of RecipeFinder-owned recipes, while TheMealDB details remain public. Complete RecipeFinder details, account Favorites, and Collections are protected through authentication and database policies. Collection records are restricted to their owners. Administrative actions require a verified Admin role. Browser credentials cannot permanently delete recipes.

The repository also retains the original seed recipe details in its source and Git history. Repository readers can view that content independently of the application's sign-in requirement.

## Known limitations

- Signed-in users can add TheMealDB recipes to Collections but cannot save them to account Favorites. Guests can save them as browser-local Favorites.
- Guest Favorites stay on the current browser or device and do not synchronize with an account.
- The Admin Dashboard accepts image URLs; direct image uploading is not active.
- Online recipe search depends on TheMealDB's availability.
- Permanent recipe deletion is not offered in the Admin Dashboard.
