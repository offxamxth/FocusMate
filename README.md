# FocusMate

FocusMate is a study and focus application with a React dashboard, optional in-browser webcam estimates, and optional Supabase accounts. Camera frames are analyzed in the browser and are not uploaded.

## Project structure

- `start_focusmate.py` – launches the React dashboard locally
- `dashboard/src/` – React interface and page components
- `dashboard/src/local-api.js` – browser-local profile, session, timer, and quest storage
- `dashboard/src/vision.js` – on-demand in-browser MediaPipe face and posture estimates for camera sessions
- `dashboard/src/ContactPage.jsx` – Contact Us, Bug Report, and Feedback forms
- `dashboard/public/models/` – face and pose models served with the app
- `focus_detector.py` and `webcam_detection/` – legacy standalone Python webcam tools; not used by the React dashboard or Vercel

## Requirements

Install Node.js 20.19 or newer (or 22.12 or newer; Vite 8 does not support
Node.js 21), then install the dashboard dependencies:

```bash
npm install --prefix dashboard
```

## Run the app

From the project root:

```bash
python start_focusmate.py
```

This starts the React dashboard in one terminal and opens it in your browser.
The optional camera analysis runs in the browser after you grant camera access.
You can also start it with `npm --prefix dashboard run dev`.
Run a production build with `npm --prefix dashboard run build`, or preview the
generated build with `npm --prefix dashboard run preview`.

## Install and use FocusMate offline

The production build includes a standalone web app manifest and branded icons.
Chrome on Android and Chrome or Edge on desktop can offer **Install FocusMate**
when their installability checks pass. Safari on iPhone and iPad uses its Share
menu's **Add to Home Screen** action; installation prompts and options vary by
browser and platform. Installing adds an app shortcut and does not create an
account. Camera use still requires a secure context (HTTPS or localhost) and
browser permission; installing never requests camera access.

The service worker precaches the built app shell and static interface assets.
It does not cache API or Supabase responses, accounts, sessions, PIN
authentication, room or presence data, or the MediaPipe model/WASM assets.
Offline access is therefore limited to loading the cached interface; sign-in,
cloud session restoration and synchronization, rooms, presence, server-backed
timers, and camera detection require a network connection. FocusMate does not
queue privileged or authenticated actions for later synchronization.

Updates are staged by the service worker and offered in the app. The reload
action is disabled while a focus timer or camera session is active, and the
user must confirm the reload. The worker script and manifest are configured
for revalidation so a deployed version can be detected rather than remaining
stale indefinitely.

## Deploy to Vercel

Import the repository into Vercel and set the **Root Directory** to
`dashboard`. The root `vercel.json` commands are relative to that directory:
install with `npm install`, build with `npm run build`, and publish `dist`.

Local profiles remain available in browser storage. When Supabase is
configured and a user signs in, the profile snapshot (including study
activity, XP, quests, achievements, wellbeing notes, and preferences) is also
stored in that account's `profiles.app_data` field and restored on another
device. Local-only profiles do not sync. Existing browser-local profiles are
not automatically merged into a cloud account. Camera frames are processed in
the browser; completed-session duration, derived signal counts, and the
session's detection configuration are stored. The landmark models are served by the app and the MediaPipe WASM
runtime is loaded from jsDelivr. Webcam access requires HTTPS or localhost.

Daily quests are generated as four distinct challenges for the browser's local
calendar date and stored in the selected profile. Their progress is derived
from recorded timer activity and completed camera sessions; camera-signal
challenges require a completed camera session. Streaks count saved study
activity rather than visits to the app. Theme, language, study style, study
goal, time format, and session preferences are saved per profile. A camera
session interrupted by a page reload is not treated as a completed session.

### Webcam signals and session controls

The React dashboard runs its existing MediaPipe face and pose detectors against
the camera video in the browser. It currently derives face presence, a
head-turn proxy (looking-away signal), eye aspect ratio (eye closure below
0.2), posture angle (slouch proxy below 52 degrees), shoulder alignment, and
screen-distance status (normalized cheek span below 0.12). These are visual
estimates, not measures of concentration, gaze direction, or health. Face or
pose models are only initialized when an enabled signal (or the live overlay)
needs them.

React session events are counted for eye closure, face absence, slouching,
screen distance, and the head-turn proxy. Each enabled counter records an
event after its condition remains active for at least two seconds, when that
event ends or the session is stopped. Shoulder tilt affects live posture status
but does not have a separate event counter. The posture reminder is separate:
it can appear after two minutes of continuous slouching when the existing
posture-alert preference is enabled. Session preferences
snapshot the signal switches and overlay choice when a camera session starts;
later profile changes apply to the next session. The optional overlay is hidden
by default and can be hidden or shown during a session without changing event
tracking. Disabled event counts are stored as `null` and displayed as “Not
monitored”; historical entries with no configuration retain the previous
all-signals-enabled interpretation.

The current React dashboard has no Focus Estimate calculation or score: its
review shows recorded signal counts and duration. The older standalone Python
tools do contain separate legacy scores, but neither is used by the React
dashboard or Vercel: `focus_detector.py` subtracts 0.5 points per looking-away
second, 0.3 per eye-closure second, and 0.2 each per slouching and face-missing
second (clamped to 0–100, without a distance penalty); `webcam_detection/`
instead subtracts the weighted session-time fractions for eye closure (0.35),
face missing (0.30), slouching (0.20), and distance (0.15), without looking
away in its score. Both legacy engines emit events only after their own
one-second and two-second persistence delays, respectively. These incompatible
scores and legacy implementations are intentionally unchanged.

Camera frames and landmarks remain in the React browser pipeline; only
derived telemetry and completed-session counts/configuration are retained,
with profile sync following the existing account storage behavior. Session XP
continues to be awarded from completed duration and existing achievements,
not from disabling any signal.

## Contact and support submissions

The Contact Us, Report a Bug, and Send Feedback forms submit directly to
Web3Forms. A success message is shown only after Web3Forms confirms the
submission. The access key determines the recipient inbox, so confirm that the
key is associated with `support.focusmate@gmail.com`.

For local development, add your existing access key to `dashboard/.env`:

```dotenv
VITE_WEB3FORMS_ACCESS_KEY=your_existing_access_key
```

The root `.gitignore` excludes `.env` files; do not commit the key. The
`VITE_` prefix means Vite embeds this key in the public frontend bundle, as
required for browser-side Web3Forms submissions. For Vercel, add the same
`VITE_WEB3FORMS_ACCESS_KEY` variable in the project’s Environment Variables
settings for the deployment environments, then redeploy so it is present at
build time. The local Python launcher and Vite dev server use the local `.env`
file. Vite preview uses the key embedded when the app was built.

Screenshots can be selected in the bug and contact forms, but are not sent with
the form; Web3Forms attachment support is not assumed. To share a screenshot,
attach it to a separate email to `support.focusmate@gmail.com`.

Run the support form integration tests with:

```bash
npm --prefix dashboard test
```

The dashboard includes an overview, a focus room with a Pomodoro timer and task
list, session insights, session reflections, daily quests, achievements, and
profile/wellbeing settings. The interface supports English, Spanish, French,
Arabic (RTL), and Hindi. The webcam is optional; the timer and task list work
without it. Use the sidebar to switch between pages.

## Focus Rooms foundation

The private room foundation creates rooms, joins by invitation code, lists
active participants, and records leave/host-close transitions. Room reads and
membership changes use authenticated RPCs; direct browser writes are not
granted. Room presence uses private, membership-authorized Realtime channels.
Shared focus sessions are controlled by the active room host through
authenticated, row-locked RPCs; clients only interpolate a visual timer from
database timestamps and re-fetch room state after Realtime updates.

Apply the social and room migrations after the profile migrations above, in
order:

1. `supabase/migrations/20261004190000_social_foundation.sql`
2. `supabase/migrations/20261004200000_friend_system.sql`
3. `supabase/migrations/20261004210000_presence_authorization.sql`
4. `supabase/migrations/20261004220000_focus_room_foundation.sql`
5. `supabase/migrations/20261004230000_room_timer_state_machine.sql`

The room snapshot exposes `status`, `created_at`, `capacity`, `host_id`,
session duration, start/active-segment/pause/break/finish timestamps,
accumulated active-focus seconds, a database-generated `server_now`, and
participant identity, role, `joined_at`, and `left_at`. Session timestamps use
`timestamptz`. The server accumulates focus time on pause, break, and finish;
break time and paused time do not count as focus. A break reaching zero does
not mutate room state automatically; the host explicitly resumes or finishes.
Only the active host can control the shared session. A finished room session
cannot be restarted; create another room for a new session.

### Safe staging migration workflow

The staging project is `knglawdgbafxscbbrkzi`. Always name that project
explicitly for every remote migration command; do not rely on whichever
project happens to be linked:

```powershell
supabase projects list --output-format json
supabase link --project-ref knglawdgbafxscbbrkzi
$link = Get-Content 'supabase\.temp\linked-project.json' -Raw | ConvertFrom-Json
if ($link.ref -ne 'knglawdgbafxscbbrkzi') { throw 'Supabase CLI is not linked to staging.' }
supabase migration list --project-ref knglawdgbafxscbbrkzi
```

Confirm the project list contains the staging ref and distinguish it from
production before continuing. Create and review a migration locally, then
inspect the exact staging plan before applying anything:

```powershell
supabase migration new room_timer_state_machine
supabase db push --dry-run --project-ref knglawdgbafxscbbrkzi --skip-vault
```

Stop if the dry run includes any unexpected migration or the target is not
unambiguously staging. Only after reviewing the SQL and planned migration list,
apply with the same explicit target and Vault safeguard, then compare the
ledger again:

```powershell
supabase db push --project-ref knglawdgbafxscbbrkzi --skip-vault
supabase migration list --project-ref knglawdgbafxscbbrkzi
```

Never use `--linked` or omit `--project-ref` for a remote migration operation.
`--skip-vault` prevents a schema push from synchronizing Vault secrets.

## Optional Supabase username/PIN accounts

Local username profiles continue to work when Supabase is not configured.
Cloud username/PIN accounts are enabled only when both
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present and valid
at build time. The project URL is prefilled in `dashboard/.env.example`. For local
development, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to an
ignored `dashboard/.env.local` file. Do not replace an existing `.env` file:
it may contain the Web3Forms setting. The app explains which setting is
missing or invalid while keeping local profiles available. Never put a
service-role or secret key in a Vite variable or frontend deployment setting.

Before enabling accounts, apply migrations in order:

1. `supabase/migrations/20261004120000_profiles.sql`
2. `supabase/migrations/20261004140000_username_pin_auth.sql`
3. `supabase/migrations/20261004160000_profile_cloud_fields.sql`

The profiles table links both `id` and `user_id` to the same Supabase Auth
identity and enforces owner-only RLS for reads, inserts, and updates. It stores
the account's XP, derived level, achievements, preferences, and complete
FocusMate snapshot. Existing local profiles are never automatically imported
or merged; each cloud account uses a separate browser-local namespace, and
signing into that same account on another device restores its cloud snapshot.
XP, level, and achievements are mirrored from the snapshot by a database
trigger. The owner can still edit their own snapshot, so this is cross-device
continuity rather than a tamper-resistant rewards ledger.

Deploy `supabase/functions/username-pin` with JWT verification disabled because
login and signup requests are unauthenticated:

```bash
supabase functions deploy username-pin --no-verify-jwt
```

The Edge Function needs the platform-provided `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, plus a private
`FOCUSMATE_PIN_PEPPER` of at least 32 characters. Configure the pepper as a
server-side Edge Function secret; never put it in `.env`, a `VITE_` variable,
the repository, or client code. The function stores salted PBKDF2 hashes of
PINs and applies database-backed login/signup rate limits. Supabase Auth still
backs the returned account session; new accounts use a non-deliverable
internal `.invalid` address as the Auth identifier. No email is used for
username/PIN login or shown as an account credential in the app.

Existing Supabase email/password users can use the one-time migration option.
Their current email/password is sent to the Edge Function over HTTPS to verify
ownership; the existing email is retained, their Auth password is replaced by
a PIN-derived bridge credential, and the existing profile row is preserved.
This migration has not been tested against a live Supabase project here.
Forgotten PIN recovery currently requires an administrator-assisted reset.

The profile row is protected by owner-only RLS. Cloud profile snapshots are
also owner-writable JSON, which enables cross-device continuity but is not a
server-authoritative rewards ledger: a technically capable signed-in user can
tamper with their own XP or session history. FocusMate has private room and
friend foundations, including host-controlled, server-authoritative shared
focus sessions; it does not have a global leaderboard. Apply and test
migrations and Auth settings in the appropriate Supabase project before
enabling cloud users. Configure only
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel; do not add
server-side Edge Function secrets to the frontend project.

Camera signals are heuristic estimates from face and pose landmarks. The
looking-away indicator uses head-turn asymmetry as a proxy; it does not
track eye gaze. These are limited observable signals, not a measure of
concentration, intelligence, fatigue, or mental state, and are not medical or
scientific advice.

At startup, enter a username to reopen its saved local profile or create a new
one. Usernames select browser-local data; they are not passwords or secure
authentication.

## Notes

- The dashboard serves its model files from `dashboard/public/models/`:
  - `face_landmarker.task`
  - `pose_landmarker.task`
- `dashboard/node_modules/` and `dashboard/dist/` are generated and should not
  be committed.

The optional standalone Python webcam tools use the separate files under
`webcam_detection/` and the root `focus_detector.py`; those scripts and their
model copies are not used by the React dashboard.
