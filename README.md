# FocusMate

FocusMate is a study and focus application with a React dashboard, optional in-browser webcam estimates, and optional Supabase accounts. Camera frames are analyzed in the browser and are not uploaded.

## Project structure

- `start_focusmate.py` – launches the React dashboard locally
- `dashboard/src/` – React interface and page components
- `dashboard/src/local-api.js` – browser-local profile, session, timer, and quest storage
- `dashboard/src/vision.js` – in-browser MediaPipe face and posture estimates
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
the browser; only completed-session duration and derived signal counts are
stored. The landmark models are served by the app and the MediaPipe WASM
runtime is loaded from jsDelivr. Webcam access requires HTTPS or localhost.

Daily quests are generated as four distinct challenges for the browser's local
calendar date and stored in the selected profile. Their progress is derived
from recorded timer activity and completed camera sessions; camera-signal
challenges require a completed camera session. Streaks count saved study
activity rather than visits to the app. Theme, language, study style, study
goal, time format, and session preferences are saved per profile. A camera
session interrupted by a page reload is not treated as a completed session.

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
tamper with their own XP or session history. The app does not provide realtime
rooms, friends, or a global leaderboard. Apply and test migrations and Auth
settings in the Supabase project before enabling cloud users. Configure only
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
