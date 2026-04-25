# OPTYMIST Fleet OS CRM Implementation Audit

Date: 2026-04-25

## Current Stack Summary

- Frontend: plain HTML/CSS/JavaScript with ES modules.
- App entry: `index.html` loads `styles.css`, Supabase JS CDN, and `js/main.js`.
- Backend/API: Supabase Auth and Postgres are used directly from the browser; Vercel serverless functions are used for Google Drive archiving/status.
- Storage policy: Supabase stores metadata/status/snapshots only. Files are archived to Google Drive through Vercel API routes.
- Deployment: static frontend plus `api/*` Vercel functions. No framework build step was found.
- Tests: no existing test runner or package manifest was found before this audit pass.

## Existing CRM Modules Found

- Auth/session: `js/auth.js`, Supabase Auth, role lookup via `profiles` and `user_roles`.
- Global state/bootstrap: `js/state.js`, `js/main.js`.
- Drivers: `js/modules/drivers.js`, basic profile creation/listing, assignment and document summary.
- Vehicles: `js/modules/vehicles.js`, basic fleet creation/listing, compliance expiry display.
- Owners: `js/modules/owners.js`.
- Assignments: `js/modules/assignments.js`, active assignment constraints, conflict close, assignment history.
- Driver settlements: `js/modules/driver-settlements.js`, manual settlement form, CSV import preview, Google Drive raw report archive, settlement snapshots.
- Owner settlements: `js/modules/owner-settlements.js`, owner payout grouping.
- Documents center: `js/modules/documents.js`, Google Drive metadata layer.
- Details panel: `js/modules/details-panel.js`, entity details and quick actions.
- Dashboard: `js/modules/dashboard.js`, high-level KPIs and operational alerts.
- Google Drive API: `api/google-drive/status.js`, `api/google-drive/archive-reports.js`, `api/_lib/google-drive.js`.
- SQL migrations: finance/document columns, document RLS, reset script.

## Missing Or Incomplete Modules

- Ledger-first financial model exists only as a legacy `ledger_entries` table reference; immutable posting/reversal rules were not fully enforced.
- Settlement engine still writes editable settlement snapshots directly; it is not yet fully ledger-derived.
- Payout batches and payout approval workflow were missing from the UI and schema foundation.
- Driver statements are not yet represented as a first-class statement view generated from ledger entries.
- Import hub is still embedded inside driver settlements; raw imports, normalized transactions and reconciliation queue need first-class tables/UI.
- Contracts are represented mainly by driver `contract_status`; full contract history/rules are missing.
- Invoices/KSeF workflow is missing beyond document metadata placeholders.
- Support tickets are missing as a domain module.
- RBAC exists at login level, but financial permission tiers are incomplete.
- Audit logs table exists in Supabase, but critical actions are not consistently logged by triggers.

## Risky Or Broken Areas Found

- `driver_settlements` inserts were blocked by RLS for the current back-office user.
- Commission percentage display showed `800` instead of `8` because the formatter multiplied an already-percent value by `100`.
- Current settlement calculations used JavaScript floating point arithmetic directly.
- Driver settlement import stores parsed data in browser memory first and writes settlement snapshots directly; raw/normalized/reconciled pipeline is not yet complete.
- Supabase client key is public in frontend by design, so RLS policies must be correct for every table.
- UI currently has no route/page for ledger, reconciliation queue, payout batches, invoices, tickets or audit log.
- Google Drive OAuth refresh token works, but future production hardening should add rotation notes and narrower operational controls.

## Recommended Implementation Order

1. Stabilize back-office RLS for existing modules: drivers, vehicles, assignments, documents, settlements, owner settlements.
2. Add ledger-first schema foundation with immutable posted entries and period locking.
3. Add payout batch schema and minimal workflow from approved/calculated driver settlements.
4. Add import pipeline tables: raw batches, raw rows, normalized transactions, reconciliation issues.
5. Move driver settlement calculations to ledger-derived summaries while preserving settlement snapshots for historical output.
6. Add driver statement view from ledger entries and settlement snapshots.
7. Add contract tables and connect commission/rent/payout rules to settlement calculation.
8. Add invoices/KSeF-ready tables and document links.
9. Add support tickets and link them to drivers, vehicles, documents, payouts, imports and ledger entries.
10. Add dedicated UI screens for ledger, import hub, reconciliation, payout batches, invoices, tickets and audit log.

## Database Changes Needed

- Expand RBAC functions to support `partner_admin`, `accountant`, `operations`, `driver_support`, `auditor`, `driver`, while preserving current `admin` and `operator`.
- Add document workflow fields: owner type/id, issue/expiry dates, review fields, rejection reason.
- Add driver lifecycle/business fields: tax/ZUS profile, cooperation type, bank account.
- Add vehicle operational/platform fields.
- Add contracts table and contract status/rule fields.
- Add raw import batches/rows, normalized platform transactions and reconciliation issues.
- Add immutable ledger columns, statuses, indexes and triggers.
- Add settlement period closing/locking fields.
- Add payout batch and payout batch item tables.
- Add driver statement snapshots or views.
- Add invoices and invoice-ledger linking tables.
- Add support tickets and generic ticket links.
- Add audit triggers for critical financial/operational tables.

## API Changes Needed

- Keep Google Drive routes as the file-storage integration boundary.
- Add future API endpoints for server-side financial posting if stricter transaction control is needed.
- Add future API endpoint for payout export generation.
- Add future API endpoint for PDF/statement generation to Google Drive.
- Add future platform adapter endpoints where APIs are available, starting with Uber API-first and keeping CSV fallback.

## UI Changes Needed

- Extend driver profile into tabs: Identity, Documents, Contracts, Vehicles, Platform Accounts, Ledger, Settlements, Payouts, Tickets, Audit.
- Add import hub page with raw import batches, normalized transactions and file links.
- Add reconciliation queue page with issue assignment and resolution.
- Add ledger page with draft/posted/reversed/locked filters and reversal/correction actions.
- Add settlement period management page with calculate/review/approve/close/lock flow.
- Add payout batches page with preview, approval, export and paid status.
- Add driver statement view per period.
- Add invoices/KSeF-ready page.
- Add tickets page and entity-linked ticket panels.
- Add audit log page for admins/auditors.

## Test Plan

- Unit-test settlement math using minor-unit calculations.
- Verify RLS as back-office roles: `partner_admin`, `accountant`, `operations`, `driver_support`, `auditor`, plus legacy `admin`/`operator`.
- Verify non-staff users cannot access back-office pages or write financial records.
- Verify posted ledger entries cannot be updated or deleted.
- Verify locked settlement periods block non-correction ledger entries.
- Verify CSV import produces raw Drive archive, preview, matched/unmatched rows and settlement/pending reconciliation results.
- Verify payout batch creation from settlement period totals.
- Verify documents can be marked missing/uploaded/pending_review/approved/rejected/expired and expiry alerts show on dashboard.

## Changes Started In This Pass

- Added a pure finance engine for minor-unit settlement calculations.
- Fixed percent normalization so `8` and `0.08` both display/calculate as `8%`.
- Expanded frontend staff-role recognition for future RBAC roles.
- Added a ledger-first SQL foundation migration for RBAC, immutable ledger triggers, payouts, imports, reconciliation, invoices, tickets, contracts and audit triggers.
- Added a focused finance-engine test script.
