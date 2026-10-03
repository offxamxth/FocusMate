# FocusMate

FocusMate is a local-first study space with a React dashboard and optional in-browser webcam estimates. It deploys to Vercel as a static app with a small optional serverless endpoint for support submissions.

## Project structure

- `start_focusmate.py` – launches the React dashboard locally
- `dashboard/src/` – React interface and page components
- `dashboard/src/local-api.js` – browser-local profile, session, timer, and quest storage
- `dashboard/src/vision.js` – in-browser MediaPipe face and posture estimates
- `api/support-submissions.js` – validated Vercel support-email endpoint
- `dashboard/public/models/` – face and pose models served with the app

## Requirements

Install Node.js 20.19 or newer, then install the dashboard dependencies:

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

## Deploy to Vercel

Import the repository into Vercel and leave the project root set to the
repository root. The root `vercel.json` installs the dashboard dependencies,
builds the Vite app, and publishes `dashboard/dist`.

Profiles and progress are stored in browser local storage. They are available
in that browser and on that device, are not synced between devices, and are not
automatically imported from older JSON profile files. Camera frames are
processed in the browser; the landmark models are served by the app and the
MediaPipe WASM runtime is loaded from jsDelivr. Webcam access requires HTTPS,
which Vercel provides.

## Contact and support submissions

The Contact Us page is available at `/contact`. Its Vercel serverless endpoint
validates contact messages, bug reports, and feedback, then forwards accepted
submissions to `support.focusmate@gmail.com` using Resend. The support inbox is
the team’s access point; FocusMate does not keep a separate contact database.
Resend and the receiving email provider handle delivery and retention under
their own policies. A success message is shown only after Resend accepts the
email. Without the server-side configuration below, submissions return an
error and users are directed to the technical support email instead.

To enable online submissions, configure these **private** environment variables
in the Vercel project settings for the relevant deployment environments:

- `RESEND_API_KEY` — a Resend API key with permission to send email.
- `SUPPORT_FROM_EMAIL` — a sender address or sender identity verified with
  Resend (for example, `FocusMate Support <support@your-verified-domain>`).

The endpoint always sends to the FocusMate support inbox; neither value is
exposed to the browser. Do not prefix these variables with `VITE_`. The API
accepts optional PNG, JPG/JPEG, or WEBP screenshots up to 1 MB, validates the file signature server-side, and
attaches the image to the support email. The Python app server and local Vite
preview do not run Vercel functions; use the Vercel development environment
with server-side variables to exercise actual email delivery.

Run the support endpoint validation tests with:

```bash
npm --prefix dashboard test
```

The dashboard includes an overview, a focus room with a Pomodoro timer and task
list, session insights, session reflections, daily quests, achievements, and
profile/wellbeing settings. The webcam is optional; the timer and task list work
without it. Use the sidebar to switch between pages.

Camera signals are heuristic estimates from face and pose landmarks. The
looking-away indicator uses head-turn asymmetry as a proxy; it does not track
eye gaze. The estimated behavioral score does not measure concentration,
intelligence, fatigue, or mental state and is not medical or scientific advice.

At startup, enter a username to reopen its saved local profile or create a new
one. Usernames select browser-local data; they are not passwords or secure
authentication.

## Notes

- The dashboard serves its model files from `dashboard/public/models/`:
  - `face_landmarker.task`
  - `pose_landmarker.task`
- `dashboard/node_modules/` and `dashboard/dist/` are generated and should not be committed.
- The legacy Python API and webcam detector are not required for the Vercel deployment.

## GitHub upload

Before pushing to GitHub, make sure the repository includes:

- `start_focusmate.py`
- `dashboard/`
- `webcam_detection/`
- `.gitignore`
- `README.md`

Do not include the local `dashboard/venv` folder.

## Initialize Git

From the project root:

```bash
git init
git add .
git commit -m "Prepare FocusMate for GitHub"
```

Create an empty repository on GitHub, then connect and push it:

```bash
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```
