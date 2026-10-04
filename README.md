# FocusMate

FocusMate is a local-first study space with a React dashboard and optional in-browser webcam estimates. It deploys to Vercel as a static app with a small optional serverless endpoint for support submissions.

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

Import the repository into Vercel and leave the project root set to the
repository root. The root `vercel.json` installs the dashboard dependencies,
builds the Vite app, and publishes `dashboard/dist`.

Each normalized username has a separate, versioned profile in browser local
storage. XP is the source of truth for level, and sessions and achievements
are saved with the profile. Data remains available after refresh or signing
out in the same browser and site origin, but is not synced between devices or
different deployment domains. Profiles are not automatically imported from
older JSON export files. Camera frames are processed in the browser; the
landmark models are served by the app and the MediaPipe WASM runtime is loaded
from jsDelivr. Webcam access requires HTTPS, which Vercel provides.

Daily quests are generated as four distinct challenges for the browser's local
calendar date and stored in the selected profile. Their progress is derived from
recorded timer activity and completed camera sessions; camera-signal challenges
require a completed camera session. Streaks count saved study activity rather
than visits to the app. FocusMate does not currently record a validated focus
score, so the dashboard reports that no score is available instead of
estimating one. Theme, language, study style, study goal, time format, and
session preferences are saved per profile. A camera session interrupted by a
page reload is not treated as a completed session.

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
profile/wellbeing settings. The webcam is optional; the timer and task list work
without it. Use the sidebar to switch between pages.

## Optional Supabase account foundation

Local username profiles continue to work when Supabase is not configured.
Email/password accounts are enabled only when both
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present at build
time. Copy the placeholders from `dashboard/.env.example` into an ignored
`dashboard/.env` file and provide the public project URL and publishable key.
Never put a service-role or secret key in a Vite variable.

Before enabling email accounts, apply
`supabase/migrations/20261004120000_profiles.sql` to the Supabase project and
configure its Auth email-confirmation and redirect-URL settings for the local
and deployed app URLs. The migration creates an owner-only `profiles` table:
RLS policies restrict row access to `auth.uid()`, and the Auth signup trigger
creates the profile using validated username metadata. Review the SQL and test
it in your own Supabase project before enabling the feature for users.

This is an Auth/profile foundation, not full cloud synchronization. Supabase
stores account identity and the supported profile/preferences fields. XP,
levels, achievements, quests, session history, camera statistics, and wellbeing
notes remain in browser-local storage and are not synced across devices. A
cloud account uses a separate local storage namespace; existing local profiles
are preserved and are not automatically imported or merged. Camera frames
remain processed in the browser and are not uploaded. The app does not yet
provide realtime rooms, friends, or a global leaderboard.

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
