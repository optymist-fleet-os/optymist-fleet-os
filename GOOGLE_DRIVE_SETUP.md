# Google Drive Setup

The CRM supports two Google Drive auth modes:

- OAuth refresh token, recommended for the current Optymist setup.
- Service account JSON key, only if service account key creation is allowed.

Your current Google Cloud organisation blocks service account key creation with:

- `iam.disableServiceAccountKeyCreation`

Use OAuth refresh token unless that policy is intentionally changed later.

## Current flow

- Driver settlement CSV files are parsed in the browser.
- If Google Drive is connected, original CSV reports are archived through Vercel API routes.
- Supabase stores metadata only: statuses, Drive IDs, links, entity binding and calculation snapshots.

## Target Drive folder

Root folder id:

- `116xjmvVnHwxLyOcmpfGIgRgGW8cVr7o-`

Folder URL:

- `https://drive.google.com/drive/folders/116xjmvVnHwxLyOcmpfGIgRgGW8cVr7o-`

## OAuth setup, recommended

Create a Google OAuth client and use it to generate a refresh token for the Google account that owns or can edit the CRM folder.

Set these Vercel environment variables:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID=116xjmvVnHwxLyOcmpfGIgRgGW8cVr7o-`

Required OAuth scope:

- `https://www.googleapis.com/auth/drive`

After adding or changing Vercel environment variables, redeploy the production deployment.

## Service account setup, optional

Use this only when service account key creation is enabled.

Set these Vercel environment variables:

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_DRIVE_PRIVATE_KEY`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID=116xjmvVnHwxLyOcmpfGIgRgGW8cVr7o-`

The target Drive folder or Shared Drive must be shared with the service account as Editor or Content manager.

## API routes

- `GET /api/google-drive/status`
- `POST /api/google-drive/archive-reports`

Both routes require an authenticated Supabase session from the CRM frontend.
