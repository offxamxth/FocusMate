# FocusMate

FocusMate is a desktop-like productivity assistant that combines webcam-based attention monitoring with a Streamlit dashboard.

## Project structure

- `start_focusmate.py` – launches the webcam detector and the dashboard together
- `dashboard/` – Streamlit dashboard files and session data
- `webcam_detection/` – Mediapipe-based camera monitoring and event detection

## Requirements

Create the dashboard environment and install its dependencies:

```bash
python -m venv dashboard/venv
dashboard\venv\Scripts\python.exe -m pip install -r dashboard/requirements.txt
```

The dashboard runs on Python 3.14. The webcam detector requires Python 3.12 or
3.13 because MediaPipe does not currently provide a compatible Python 3.14
package. Install its additional dependencies with:

```bash
py -3.13 -m pip install -r webcam_detection/requirements.txt
```

The launcher uses `dashboard/venv` by default. To use another dashboard or
webcam Python installation, set `FOCUSMATE_DASHBOARD_PYTHON` or
`FOCUSMATE_WEBCAM_PYTHON` before starting the app.

## Run the app

From the project root:

```bash
python start_focusmate.py
```

To open only the dashboard:

```bash
dashboard\venv\Scripts\python.exe -m streamlit run dashboard\step7_analytics.py
```

This starts:

1. the webcam AI detection
2. the Streamlit dashboard in the browser

## Notes

- The project expects the model files in `webcam_detection/`:
  - `face_landmarker.task`
  - `pose_landmarker.task`
- The local virtual environment folder should not be committed to GitHub.
- `dashboard/session_data.json` and `dashboard/player_profile.json` are local
  runtime files and are ignored by Git.

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
