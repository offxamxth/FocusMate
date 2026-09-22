# FocusMate

FocusMate is a desktop-like productivity assistant that combines webcam-based attention monitoring with a Streamlit dashboard.

## Project structure

- `start_focusmate.py` – launches the webcam detector and the dashboard together
- `dashboard/` – Streamlit dashboard files and session data
- `webcam_detection/` – Mediapipe-based camera monitoring and event detection

## Requirements

Install Python dependencies:

```bash
pip install -r dashboard/requirements.txt
```

## Run the app

From the project root:

```bash
python start_focusmate.py
```

This starts:

1. the webcam AI detection
2. the Streamlit dashboard in the browser

## Notes

- The project expects the model files in `webcam_detection/`:
  - `face_landmarker.task`
  - `pose_landmarker.task`
- The local virtual environment folder should not be committed to GitHub.

## GitHub upload

Before pushing to GitHub, make sure the repository includes:

- `start_focusmate.py`
- `dashboard/`
- `webcam_detection/`
- `.gitignore`
- `README.md`

Do not include the local `dashboard/venv` folder.
