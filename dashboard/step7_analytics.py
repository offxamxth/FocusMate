"""
FocusMate Quest Dashboard
Gamified, student-wellbeing-first Streamlit dashboard.
Persistent player data is stored separately from live webcam telemetry.
"""

import json, os, tempfile, subprocess, sys
from pathlib import Path
from datetime import datetime, date
import pandas as pd
import streamlit as st
from streamlit_autorefresh import st_autorefresh

st.set_page_config(page_title="FocusMate Quest", page_icon="🎮", layout="wide")
st_autorefresh(interval=3000, key="quest_refresh")

HERE = os.path.dirname(os.path.abspath(__file__))
SESSION_FILE = os.path.join(HERE, "session_data.json")
PROFILE_FILE = os.path.join(HERE, "player_profile.json")

XP_PER_MINUTE = 2
LEVEL_STEP = 100

# ============================================================
# WEBCAM SESSION CONTROLLER
# ============================================================

WEBCAM_DIR = os.path.abspath(
    os.path.join(HERE, "..", "webcam_detection")
)

WEBCAM_FILE = os.path.join(
    WEBCAM_DIR,
    "integrated_detection.py"
)

# Set this to the Python 3.12/3.13 executable that has MediaPipe.
# Example: C:\\Python312\\python.exe
WEBCAM_PYTHON = os.environ.get(
    "FOCUSMATE_WEBCAM_PYTHON",
    sys.executable
)

# Keep the process handle across Streamlit reruns.
if "webcam_process" not in st.session_state:
    st.session_state.webcam_process = None


def webcam_is_running():
    process = st.session_state.webcam_process
    return process is not None and process.poll() is None


def start_webcam():
    if webcam_is_running():
        return True, "Your webcam session is already running."

    if not os.path.isfile(WEBCAM_FILE):
        return False, f"Detector not found: {WEBCAM_FILE}"

    if not os.path.isfile(WEBCAM_PYTHON):
        return False, (
            "Python 3.12/3.13 with MediaPipe was not found. "
            "Install a compatible Python version and set "
            "FOCUSMATE_WEBCAM_PYTHON to its python.exe path."
        )

    try:
        # Check MediaPipe before starting the detector.
        check = subprocess.run(
            [
                WEBCAM_PYTHON,
                "-c",
                "import cv2, mediapipe"
            ],
            capture_output=True,
            text=True,
            timeout=20
        )

        if check.returncode != 0:
            return False, (
                "MediaPipe is not installed in the selected "
                "webcam Python environment.\n\n"
                + check.stderr[-1500:]
            )
        # Remove a stale stop request before starting a new session.
        stop_file = os.path.join(HERE, "stop_session.request")

        if os.path.exists(stop_file):
            try:
                os.remove(stop_file)
            except OSError as error:
                return False, f"Could not clear old stop request: {error}"
        
        process = subprocess.Popen(
            [WEBCAM_PYTHON, WEBCAM_FILE],
            cwd=WEBCAM_DIR
        )

        st.session_state.webcam_process = process

        return True, "Webcam detector started."

    except Exception as exc:
        return False, str(exc)


def stop_webcam():
    process = st.session_state.webcam_process

    if process is None or process.poll() is not None:
        st.session_state.webcam_process = None
        return False, "No webcam process is running."

    # Ask the detector to finish and save the session.
    stop_file = os.path.join(
        HERE,
        "stop_session.request"
    )

    try:
        with open(stop_file, "w", encoding="utf-8") as f:
            f.write("stop")

        # Give the detector time to save its session.
        process.wait(timeout=30)

    except subprocess.TimeoutExpired:
        return False, (
            "The detector did not stop within 30 seconds. "
            "It is still running so your session data is not "
            "forcefully terminated."
        )

    except OSError as exc:
        return False, str(exc)

    st.session_state.webcam_process = None

    return True, "Session ended. Your progress has been saved."

def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default

def atomic_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="fm_", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try: os.remove(tmp)
            except OSError: pass

def fresh_profile():
    return {
        "version": 1, "total_xp": 0, "total_study_seconds": 0,
        "sessions_completed": 0, "quest_claims": [],
        "achievements": [], "session_history": [],
        "last_session_id": None, "created_at": datetime.now().isoformat()
    }

profile = read_json(PROFILE_FILE, None)
if not isinstance(profile, dict):
    profile = fresh_profile()
    atomic_json(PROFILE_FILE, profile)
for key, default in fresh_profile().items():
    profile.setdefault(key, default)

live = read_json(SESSION_FILE, {})
if not isinstance(live, dict): live = {}
active = bool(live.get("session_active", False))
last_updated = live.get("last_updated")
fresh = False
if last_updated:
    try:
        stamp = datetime.fromisoformat(last_updated)
        fresh = (datetime.now() - stamp).total_seconds() < 20
    except (ValueError, TypeError):
        pass
connected = fresh and active and bool(live.get("face_detected", False))

# Avoid awarding duplicate XP on each dashboard refresh.
# Session ID is derived from the detector's session-start timestamp when present.
session_id = live.get("session_id") or live.get("session_started_at")
if not session_id and last_updated and active:
    # Fallback: use the session start timestamp saved by current detector when available;
    # do not award XP from an unstable "last_updated" value.
    session_id = live.get("session_start_time")

# ============================================================
# PROFILE SYNC
# ============================================================
# The detector is the sole XP writer.
# The dashboard only reads the saved profile.
# This prevents duplicate XP awards on dashboard refresh.

profile = read_json(PROFILE_FILE, None)

if not isinstance(profile, dict):
    profile = fresh_profile()

for key, default in fresh_profile().items():
    profile.setdefault(key, default)

history = profile.get("session_history", [])

if not isinstance(history, list):
    history = []

known_ids = {
    str(item.get("session_id"))
    for item in history
    if isinstance(item, dict) and item.get("session_id")
}

total_xp = max(0, int(profile.get("total_xp", 0)))
level = total_xp // LEVEL_STEP + 1
xp_into_level = total_xp % LEVEL_STEP
progress = xp_into_level / LEVEL_STEP
total_minutes = int(profile.get("total_study_seconds", 0)) // 60
sessions = int(profile.get("sessions_completed", 0))

# Current telemetry is guidance, never a grade.
posture = live.get("posture") or "Waiting for data"
distance_status = live.get("distance_status") or "Not measured"
face_detected = live.get("face_detected")
eyes_closed = live.get("eyes_closed")
looking_away = live.get("looking_away")
status = live.get("status") or "Waiting for webcam"
ear = live.get("ear")
updated_text = last_updated or "No telemetry received"

st.markdown("""
<style>
.stApp {background: radial-gradient(ellipse at top left, #22204a 0%, #11152b 42%, #0b1020 100%); color:#f4f5ff;}
.block-container {max-width: 1280px; padding-top: 1.5rem;}
.hero {padding:1.5rem 1.8rem; border:1px solid #393b68; border-radius:24px;
background:linear-gradient(115deg,rgba(104,76,220,.28),rgba(30,180,190,.12));}
.panel {padding:1.1rem 1.25rem; border-radius:18px; border:1px solid #303657;
background:rgba(25,31,58,.88); min-height:135px;}
.muted {color:#b6bddb;} .big {font-size:2.1rem;font-weight:800;line-height:1.15;}
.smallcaps {font-size:.78rem;letter-spacing:.11em;color:#a9b4df;font-weight:700;}
.quest {padding:1rem 1.1rem;border-radius:16px;background:#1b2341;border:1px solid #384268;margin-bottom:.6rem;}
div[data-testid="stMetric"] {background:#1b2341;padding:15px;border-radius:16px;border:1px solid #303657;}
</style>
""", unsafe_allow_html=True)

st.markdown(f"""
<div class="hero">
 <div class="smallcaps">🎮 FOCUSMATE QUEST • YOUR WELLBEING ADVENTURE</div>
 <h1 style="margin:.4rem 0;color:#fff">Every small step counts.</h1>
 <p class="muted" style="font-size:1.08rem;margin-bottom:0">Build healthy study habits, take care of yourself, and level up at your own pace.</p>
</div>
""", unsafe_allow_html=True)
st.write("")

a,b,c,d=st.columns(4)
with a:
    st.metric("⭐ Player Level", f"Level {level}", f"{xp_into_level}/{LEVEL_STEP} XP")
with b:
    st.metric("✨ Lifetime XP", f"{total_xp:,}", "Never lost when app closes")
with c:
    st.metric("📚 Study time", f"{total_minutes} min", "Across saved sessions")
with d:
    st.metric("🏆 Sessions", sessions, "Completed sessions saved")

st.progress(progress, text=f"Level {level} progress — {LEVEL_STEP-xp_into_level} XP to Level {level+1}")
st.caption("XP is earned for completed study time and positive wellbeing actions. There are no deductions for blinking, moving, or taking breaks.")
st.write("")

left,right=st.columns([1.35,1])
with left:
    st.subheader("🗺️ Today's quests")
    st.markdown('<div class="quest"><b>📖 The Focus Sprint</b><br><span class="muted">Work on one task for 15 minutes. Earn 30 XP when you finish.</span></div>',unsafe_allow_html=True)
    st.markdown('<div class="quest"><b>🌿 Recharge Checkpoint</b><br><span class="muted">Take a short screen break, stretch, or drink water. Your wellbeing matters.</span></div>',unsafe_allow_html=True)
    st.markdown('<div class="quest"><b>🧠 Reflection Bonus</b><br><span class="muted">At the end, name one thing you accomplished and one thing to try next time.</span></div>',unsafe_allow_html=True)
    st.info("Quest tracking is currently a friendly checklist. Persistent XP from webcam sessions activates once the detector writes a stable session ID and completion record.")
with right:
    st.subheader("📡 Study buddy status")
        # ================================================
    # SESSION CONTROLS
    # ================================================

    running = webcam_is_running()

    if running:
        st.success("Your webcam process is running.")

        if st.button(
            "⏹️ End Study Session",
            type="primary",
            use_container_width=True,
            key="end_study_session"
        ):
            ok, message = stop_webcam()

            if ok:
                st.success(message)
            else:
                st.warning(message)

            st.rerun()

    else:
        st.info("Ready when you are.")

        if st.button(
            "▶️ Start Study Session",
            type="primary",
            use_container_width=True,
            key="start_study_session"
        ):
            ok, message = start_webcam()

            if ok:
                st.success(message)
            else:
                st.error(message)

            st.rerun()

    st.divider()
    if connected:
        st.success("Webcam data is live. You're all set!")
    elif active and not fresh:
        st.warning("The session is marked active, but webcam data is stale. Check that the detector is still running.")
    elif not active:
        st.info("No active study session. Start FocusMate from the launcher when you're ready.")
    else:
        st.info("Webcam is running, but a face isn't currently detected. This is not a focus penalty.")
    st.markdown(f'<div class="panel"><div class="smallcaps">CURRENT SIGNALS</div><h3 style="color:#fff;margin:.6rem 0">{status}</h3><p class="muted">Posture: {posture}<br>Distance estimate: {distance_status}<br>Face detected: {("Yes" if face_detected else "No / unknown")}</p><p class="muted" style="font-size:.8rem">Last telemetry: {updated_text}</p></div>',unsafe_allow_html=True)
    st.caption("Camera estimates can be inaccurate. Use these as gentle reminders, not medical advice or grades.")

st.write("")
st.subheader("🌱 Your wellbeing toolkit")
w1,w2,w3=st.columns(3)
with w1:
    st.markdown('<div class="panel"><h3>👀 Eye reset</h3><p class="muted">Look away from the screen and blink naturally. A blink is normal—not a mistake.</p></div>',unsafe_allow_html=True)
with w2:
    st.markdown('<div class="panel"><h3>🧍 Move a little</h3><p class="muted">Relax your shoulders, stretch, and adjust your chair if you need to.</p></div>',unsafe_allow_html=True)
with w3:
    st.markdown('<div class="panel"><h3>💧 Recharge</h3><p class="muted">A sip of water or a short break can be part of a productive session.</p></div>',unsafe_allow_html=True)

st.write("")
st.subheader("📜 Adventure history")
if history:
    hist_df=pd.DataFrame(history)
    if "date" in hist_df.columns:
        hist_df["date"]=pd.to_datetime(hist_df["date"],errors="coerce").dt.strftime("%b %d, %Y %H:%M")
    show_cols=[c for c in ["date","seconds","xp","wellbeing_note"] if c in hist_df.columns]
    st.dataframe(hist_df[show_cols].rename(columns={"date":"Completed","seconds":"Study seconds","xp":"XP earned","wellbeing_note":"Note"}),use_container_width=True,hide_index=True)
else:
    st.markdown('<div class="panel"><h3 style="color:#fff">Your adventure starts here ✨</h3><p class="muted">Complete your first session and your saved journey will appear here.</p></div>',unsafe_allow_html=True)

with st.expander("⚙️ Profile & data"):
    st.write(f"Player profile file: `{PROFILE_FILE}`")
    st.write("Your lifetime XP and history are stored in `player_profile.json` and are separate from live webcam data.")
    if st.button("Export player profile as JSON"):
        st.download_button("Download profile",json.dumps(profile,indent=2),file_name="focusmate_player_profile.json",mime="application/json")
    st.caption("Do not delete player_profile.json if you want to keep your levels and progress.")

st.caption("FocusMate Quest • Progress, not perfection. Take care of your mind and body.")
