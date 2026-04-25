# Google Drive Setup

This CRM now includes a server-side Google Drive archive layer for weekly import reports.

## Current flow

- Driver settlement CSV files are parsed in the browser.
- If Google Drive is configured, the original CSV files are archived through Vercel API routes.
- Supabase stores metadata only: status, drive IDs, links, entity binding.

## Vercel environment variables

Set these in the Vercel project:

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_DRIVE_PRIVATE_KEY`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

For the provided target folder, the root folder id is:

- `116xjmvVnHwxLyOcmpfGIgRgGW8cVr7o-`

## Recommended auth model

Use a Google service account for back-office automation.

Recommended when:

- the CRM should save reports and generated PDFs automatically
- uploads should not depend on a staff member being logged in to Google
- the folder can be shared to the service account or moved into a Shared Drive

## What to do in Google Cloud

1. Create or use a Google Cloud project.
2. Enable the Google Drive API.
3. Create a service account.
4. Generate a JSON key for that service account.
5. Put the service account email and private key into Vercel env vars.
6. Share the target folder or Shared Drive with that service account as editor/content manager.

## Important note about folder ownership

For production, Shared Drive is the cleanest setup.

If the target folder stays only in a personal My Drive context and the service account cannot write there cleanly, switch to a Shared Drive or use OAuth refresh-token auth in a next pass.

## Current API routes

- `GET /api/google-drive/status`
- `POST /api/google-drive/archive-reports`

Both routes require an authenticated Supabase session from the CRM frontend.
