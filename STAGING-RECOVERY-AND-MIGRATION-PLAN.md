# Staging Recovery and Migration Plan

## Current safety status

- Staging is `knglawdgbafxscbbrkzi`. The local dashboard environment points to this project; no database request or write was made during this work.
- Production is `qdvxfpzoychtgfenfjrs`. It was not contacted, and this plan does not authorize production changes.
- At the last read-only staging audit, WAL-G was enabled, but point-in-time recovery (PITR) was disabled and no physical backup was confirmed. There is not yet evidence of a tested, restorable recovery point.
- `supabase db push --dry-run --linked` stopped at out-of-order migration history. An `--include-all --dry-run` listed pending migrations, but no migration was applied.
- There is no available local Supabase/Postgres service to execute the SQL migrations locally.

## Migration history requiring reconciliation

The last read-only comparison indicated these migrations as pending:

- `20261011170000_room_quest_reroll_guard.sql`
- `20261016200000_fix_room_quest_reroll_request_type.sql`
- `20261016210000_enable_verified_room_late_join.sql`
- `20261016220000_preserve_finished_room_state_on_host_leave.sql`
- `20261017120000_global_xp_leaderboard.sql`

The audit also found staging successors or equivalent behavior already applied for:

- `20261012120000_room_quest_reroll_guard.sql`
- `20261012130000_room_late_join.sql`
- `20261017100000_fix_focusmate_leaderboard_scope_visibility.sql`

The older pending reroll migrations may replace later function bodies if applied blindly. The late-join migration appears to duplicate behavior already applied, while the host-leave and Global-XP leaderboard migrations appear to contain behavior not yet present on staging. The new local-only `20261018120000_verified_daily_quest_reroll_tokens.sql` is also unapplied. Do not use `--include-all` as a way to bypass the ordering warning.

## Required recovery gate

Before any staging change:

1. In the Supabase dashboard, enable an appropriate recovery mechanism for the staging project (PITR or a verified database backup).
2. Record the project ref, recovery-point identifier and UTC timestamp, retention, and backup scope. Do not put credentials in this document.
3. Restore that point into an isolated non-production project and verify that the database is usable. Merely seeing WAL-G or a backup listed is not proof of successful recovery.
4. If a restorable recovery point cannot be confirmed, stop. Do not apply migrations or modify staging data.

## Required migration review

After the recovery gate is met, but before deployment:

1. Read the staging migration ledger and schema state without writing to the database.
2. Compare every pending migration with its already-applied successors and the live definitions of the affected functions, policies, and tables.
3. Produce a reconciled, ordered staging-only migration set. Preserve the later reroll guard, late-join, and leaderboard-visibility behavior; do not reapply an older function body over a known fix.
4. Review the exact SQL diff for every migration, including the Global-XP RPC contract and the daily token wallet/award/reroll RPC.
5. Run a dry-run of the reconciled set and confirm it contains only the reviewed staging changes. A dry-run alone is not deployment approval.

## Deployment approval and verification

After presenting the recovery evidence and exact migration set, request explicit approval for staging-only deployment. Until that approval is received:

- Do not apply migrations, create or alter staging records, or run reward/reroll tests against staging.
- Do not deploy or configure anything in production.

If approved, apply only the reviewed staging set, then verify RPC signatures, RLS and Realtime authorization, verified room progress, persisted token/XP invariants, and the client-facing leaderboard contract. Record the applied migration versions and test outcomes. Stop and report any mismatch rather than attempting an unreviewed repair.

## Video integration dependency

No remote-video provider is configured in the inspected application. The existing Supabase Realtime channel is used for room presence and state updates, not media transport. Any future signaling policy migration or provider-specific database/function change must be included in the same recovery and migration review, and must receive separate explicit staging-only approval before application.

The local implementation now includes a `focus-room-video-token` Edge Function. It checks the caller's authenticated identity, active room membership, and room state using the caller's Supabase permissions before issuing a short-lived LiveKit join token. It uses no service-role key and adds no database migration. LiveKit configuration (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`) is not present; no provider project or secrets were created, and no function was deployed.
