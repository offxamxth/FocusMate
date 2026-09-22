"""
FocusMate - Automatic Launcher

Starts:
    1. Webcam AI detection
    2. Streamlit dashboard

The existing webcam and dashboard files are not modified.
"""

import os
import sys
import time
import subprocess
import webbrowser


# =========================================================
# PATHS
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

WEBCAM_DIR = os.path.join(
    BASE_DIR,
    "webcam_detection"
)

DASHBOARD_DIR = os.path.join(
    BASE_DIR,
    "dashboard"
)

WEBCAM_FILE = os.path.join(
    WEBCAM_DIR,
    "integrated_detection.py"
)

DASHBOARD_FILE = os.path.join(
    DASHBOARD_DIR,
    "step7_analytics.py"
)

# Dashboard virtual environment Python
DASHBOARD_PYTHON = os.path.join(
    DASHBOARD_DIR,
    "venv",
    "Scripts",
    "python.exe"
)


# =========================================================
# CHECK FILES
# =========================================================

print("=" * 60)
print("                 FOCUSMATE")
print("             Automatic Launcher")
print("=" * 60)

print()

if not os.path.exists(WEBCAM_FILE):

    print("ERROR: Webcam file not found:")
    print(WEBCAM_FILE)
    input("\nPress Enter to exit...")
    sys.exit(1)


if not os.path.exists(DASHBOARD_FILE):

    print("ERROR: Dashboard file not found:")
    print(DASHBOARD_FILE)
    input("\nPress Enter to exit...")
    sys.exit(1)


if not os.path.exists(DASHBOARD_PYTHON):

    print("ERROR: Dashboard virtual environment not found:")
    print(DASHBOARD_PYTHON)
    print()
    print("Make sure the dashboard venv exists.")
    input("\nPress Enter to exit...")
    sys.exit(1)


# =========================================================
# START WEBCAM AI
# =========================================================

print("Starting webcam AI...")
print()

webcam_process = subprocess.Popen(
    [
        sys.executable,
        WEBCAM_FILE,
    ],
    cwd=WEBCAM_DIR,
)


# =========================================================
# GIVE CAMERA TIME TO START
# =========================================================

print("Waiting for webcam AI to initialize...")

time.sleep(3)


# =========================================================
# START DASHBOARD
# =========================================================

print("Starting FocusMate dashboard...")
print()

dashboard_process = subprocess.Popen(
    [
        DASHBOARD_PYTHON,
        "-m",
        "streamlit",
        "run",
        DASHBOARD_FILE,
    ],
    cwd=DASHBOARD_DIR,
)


# =========================================================
# WAIT FOR DASHBOARD
# =========================================================

time.sleep(4)


# =========================================================
# OPEN BROWSER
# =========================================================

print("Opening FocusMate dashboard...")

webbrowser.open(
    "http://localhost:8501"
)


# =========================================================
# RUN UNTIL CLOSED
# =========================================================

print()
print("=" * 60)
print("             FOCUSMATE IS RUNNING")
print("=" * 60)
print()
print("Camera AI:     RUNNING")
print("Dashboard:     RUNNING")
print()
print("Dashboard:")
print("http://localhost:8501")
print()
print("Close this launcher to stop FocusMate.")
print("=" * 60)


try:

    while True:

        # If webcam closes unexpectedly
        if webcam_process.poll() is not None:

            print()
            print("⚠️ Webcam AI has stopped.")

            break

        # If dashboard closes unexpectedly
        if dashboard_process.poll() is not None:

            print()
            print("⚠️ Dashboard has stopped.")

            break

        time.sleep(1)


except KeyboardInterrupt:

    print()
    print("Stopping FocusMate...")


# =========================================================
# CLEAN SHUTDOWN
# =========================================================

print("Stopping webcam AI...")
webcam_process.terminate()

print("Stopping dashboard...")
dashboard_process.terminate()

print()
print("FocusMate closed.")