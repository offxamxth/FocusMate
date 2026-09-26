"""
FocusMate launcher.

Starts the Streamlit dashboard. Webcam detection is started on demand
from the FocusMate dashboard.
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

DASHBOARD_DIR = os.path.join(
    BASE_DIR,
    "dashboard"
)

DASHBOARD_FILE = os.path.join(
    DASHBOARD_DIR,
    "step7_analytics.py"
)

# Override either interpreter when the project uses a custom environment.
DASHBOARD_PYTHON = os.environ.get(
    "FOCUSMATE_DASHBOARD_PYTHON",
    os.path.join(DASHBOARD_DIR, "venv", "Scripts", "python.exe")
)
WEBCAM_PYTHON = os.environ.get("FOCUSMATE_WEBCAM_PYTHON", sys.executable)


# =========================================================
# CHECK FILES
# =========================================================

print("=" * 60)
print("                 FOCUSMATE")
print("             Automatic Launcher")
print("=" * 60)

print()

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
    env={**os.environ, "FOCUSMATE_WEBCAM_PYTHON": WEBCAM_PYTHON},
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
print("Dashboard:     RUNNING")
print("Webcam AI:     starts only when requested in the dashboard")
print()
print("Dashboard:")
print("http://localhost:8501")
print()
print("Close this launcher to stop FocusMate.")
print("=" * 60)


try:

    while True:

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

print("Stopping dashboard...")
dashboard_process.terminate()

print()
print("FocusMate closed.")