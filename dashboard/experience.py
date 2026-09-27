"""Animated, multi-page Streamlit experience for FocusMate."""

import json
import hashlib
import html
import io
import math
import os
import re
import shutil
import subprocess
import struct
import sys
import tempfile
import threading
import time
import wave
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import pandas as pd
import streamlit as st
from streamlit_autorefresh import st_autorefresh


HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE_FILE = os.path.join(HERE, "player_profile.json")
PROFILE_DIR = os.path.join(HERE, "profiles")
SESSION_FILE = os.path.join(HERE, "session_data.json")
WEBCAM_DIR = os.path.abspath(os.path.join(HERE, "..", "webcam_detection"))
WEBCAM_FILE = os.path.join(WEBCAM_DIR, "integrated_detection.py")


def resolve_webcam_python():
    candidates = [
        os.environ.get("FOCUSMATE_WEBCAM_PYTHON"),
        os.path.join(os.path.expanduser("~"), "focusmate-webcam-venv", "Scripts", "python.exe"),
        os.path.join(os.path.expanduser("~"), "focusmate-webcam-venv", "bin", "python"),
        shutil.which("python"),
        shutil.which("python3"),
        sys.executable,
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    for candidate in candidates:
        if candidate:
            return candidate
    return sys.executable


DEFAULT_WEBCAM_PYTHON = resolve_webcam_python()
WEBCAM_PYTHON = os.environ.get("FOCUSMATE_WEBCAM_PYTHON", DEFAULT_WEBCAM_PYTHON)
SESSION_STOP_PORT = 8765
SESSION_STOP_SERVER = None
LEVEL_STEP = 100

QUESTS = [
    {
        "id": "focus_sprint",
        "title": "The deep-work sprint",
        "description": "Spend 15 minutes with one task and no distractions.",
        "reward": 30,
        "icon": "🎯",
    },
    {
        "id": "recharge",
        "title": "The recharge break",
        "description": "Step away, stretch, or rest your eyes for a moment.",
        "reward": 15,
        "icon": "🌿",
    },
    {
        "id": "hydration",
        "title": "A little hydration",
        "description": "Have a glass of water before your next study block.",
        "reward": 10,
        "icon": "💧",
    },
    {
        "id": "reflection",
        "title": "A small reflection",
        "description": "Write one thing that went well today.",
        "reward": 10,
        "icon": "✨",
    },
]


def normalize_username(username):
    value = str(username or "").strip().lstrip("@").casefold()
    if not value or len(value) > 32 or not re.fullmatch(r"[a-z0-9_.-]+", value):
        return ""
    return value


def user_data_directory(username=None):
    if username is None:
        username = st.session_state.get("active_username")
    normalized = normalize_username(username)
    if not normalized:
        return HERE
    key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]
    return os.path.join(PROFILE_DIR, key)


def user_data_file(filename, username=None):
    return os.path.join(user_data_directory(username), filename)


def profile_file(username=None):
    if username is None:
        username = st.session_state.get("active_username")
    normalized = normalize_username(username)
    if not normalized:
        return PROFILE_FILE
    return user_data_file("player_profile.json", normalized)


def profile_exists(username):
    normalized = normalize_username(username)
    if not normalized:
        return False
    if os.path.isfile(profile_file(normalized)):
        return True
    legacy = read_json(PROFILE_FILE, None)
    return isinstance(legacy, dict) and normalize_username(legacy.get("username")) == normalized


def fresh_profile(username="focusfriend"):
    return {
        "version": 1,
        "player_name": "Focus friend",
        "username": normalize_username(username) or "focusfriend",
        "total_xp": 0,
        "total_study_seconds": 0,
        "sessions_completed": 0,
        "quest_claims": [],
        "achievements": [],
        "session_history": [],
        "tasks": [],
        "water_glasses_today": 0,
        "water_glasses_last_reset": date.today().isoformat(),
        "session_wellbeing": {},
        "session_preferences": {
            "focus_monitoring": True,
            "posture_alerts": True,
            "mood_checkins": True,
            "session_chimes": False,
            "session_length_minutes": 25,
            "daily_goal_minutes": 180,
        },
        "last_session_id": None,
        "created_at": datetime.now().isoformat(),
    }


def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def bounded_int(value, default, minimum, maximum):
    if isinstance(value, bool):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(minimum, min(maximum, parsed))


def load_profile(username=None):
    normalized = normalize_username(
        username if username is not None else st.session_state.get("active_username")
    )
    path = profile_file(normalized)
    loaded = read_json(path, None)
    if not isinstance(loaded, dict) and normalized:
        legacy = read_json(PROFILE_FILE, None)
        if isinstance(legacy, dict) and normalize_username(legacy.get("username")) == normalized:
            loaded = legacy
    profile = loaded if isinstance(loaded, dict) else fresh_profile(normalized or "focusfriend")
    if normalized:
        profile["username"] = normalized
    for key, value in fresh_profile().items():
        profile.setdefault(key, value)
    if not isinstance(profile.get("username"), str):
        profile["username"] = "focusfriend"
    if not isinstance(profile["session_history"], list):
        profile["session_history"] = []
    profile["session_history"] = [
        entry for entry in profile["session_history"] if isinstance(entry, dict)
    ]
    if not isinstance(profile["quest_claims"], list):
        profile["quest_claims"] = []
    profile["quest_claims"] = [
        claim for claim in profile["quest_claims"] if isinstance(claim, dict)
    ]
    if not isinstance(profile["tasks"], list):
        profile["tasks"] = []
    profile["tasks"] = [task for task in profile["tasks"] if isinstance(task, dict)]
    if not isinstance(profile["session_wellbeing"], dict):
        profile["session_wellbeing"] = {}
    wellbeing = profile["session_wellbeing"]
    try:
        sleep_hours = float(wellbeing.get("sleep_hours", 0.0) or 0.0)
    except (TypeError, ValueError, OverflowError):
        sleep_hours = 0.0
    wellbeing["sleep_hours"] = max(0.0, min(24.0, sleep_hours)) if math.isfinite(sleep_hours) else 0.0
    wellbeing["water_glasses"] = bounded_int(
        profile.get("water_glasses_today", wellbeing.get("water_glasses", 0)), 0, 0, 100
    )
    wellbeing["reflection"] = str(wellbeing.get("reflection") or "")[:500]
    if not isinstance(wellbeing.get("mood"), str):
        wellbeing.pop("mood", None)
    if not isinstance(wellbeing.get("mood_checkin_date"), str):
        wellbeing.pop("mood_checkin_date", None)
    profile["total_xp"] = bounded_int(profile.get("total_xp"), 0, 0, 2**63 - 1)
    profile["total_study_seconds"] = bounded_int(
        profile.get("total_study_seconds"), 0, 0, 2**63 - 1
    )
    profile["sessions_completed"] = bounded_int(
        profile.get("sessions_completed"), 0, 0, 2**31 - 1
    )
    profile["water_glasses_today"] = bounded_int(
        profile.get("water_glasses_today"), 0, 0, 100
    )
    water_reset_date = str(profile.get("water_glasses_last_reset") or "")
    today = date.today().isoformat()
    if water_reset_date != today:
        profile["water_glasses_today"] = 0
        profile["water_glasses_last_reset"] = today
    wellbeing["water_glasses"] = profile["water_glasses_today"]
    if not isinstance(profile.get("session_preferences"), dict):
        profile["session_preferences"] = {}
    default_prefs = fresh_profile()["session_preferences"]
    profile["session_preferences"] = {**default_prefs, **profile["session_preferences"]}
    for key in ("focus_monitoring", "posture_alerts", "mood_checkins", "session_chimes"):
        if not isinstance(profile["session_preferences"].get(key), bool):
            profile["session_preferences"][key] = default_prefs[key]
    profile["session_preferences"]["session_length_minutes"] = bounded_int(
        profile["session_preferences"].get("session_length_minutes"), 25, 15, 120
    )
    profile["session_preferences"]["daily_goal_minutes"] = bounded_int(
        profile["session_preferences"].get("daily_goal_minutes"), 180, 30, 720
    )
    return profile


def save_profile(profile, username=None):
    normalized = normalize_username(
        username if username is not None else st.session_state.get("active_username")
    )
    path = profile_file(normalized)
    if normalized:
        profile["username"] = normalized
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temporary_path = tempfile.mkstemp(
        prefix="focusmate_", suffix=".tmp", dir=os.path.dirname(path)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(profile, file, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


def load_live_data():
    username = normalize_username(st.session_state.get("active_username"))
    path = user_data_file("session_data.json", username)
    if username and not os.path.isfile(path):
        legacy = read_json(PROFILE_FILE, None)
        if isinstance(legacy, dict) and normalize_username(legacy.get("username")) == username:
            path = SESSION_FILE
    data = read_json(path, {})
    return data if isinstance(data, dict) else {}


def mark_session_closed(marker_path=None):
    try:
        path = marker_path or user_data_file("session_closed.marker")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            file.write(datetime.now().isoformat())
    except OSError:
        pass


def consume_session_reset_marker():
    marker_path = user_data_file("session_closed.marker")
    if not os.path.exists(marker_path):
        return False

    try:
        with open(marker_path, "r", encoding="utf-8") as file:
            marker_value = (file.read() or "").strip()
    except OSError:
        marker_value = ""

    if marker_value:
        try:
            marker_time = datetime.fromisoformat(marker_value)
            if (datetime.now() - marker_time).total_seconds() < 5:
                return False
        except ValueError:
            pass

    live = load_live_data()
    if isinstance(live, dict) and bool(live.get("session_active")):
        return False

    try:
        os.remove(marker_path)
    except OSError:
        pass
    return True


def webcam_is_running():
    process = st.session_state.get("webcam_process")
    return process is not None and process.poll() is None


def live_snapshot_is_fresh(live, max_age=35):
    updated = live.get("last_updated")
    if not updated:
        return False
    try:
        age = (datetime.now() - datetime.fromisoformat(updated)).total_seconds()
    except (TypeError, ValueError):
        return False
    return 0 <= age <= max_age


def webcam_session_active():
    if webcam_is_running():
        return True

    window = st.session_state.get("webcam_start_time")
    if isinstance(window, datetime):
        age = (datetime.now() - window).total_seconds()
        if 0 <= age <= 35:
            return True

    live = load_live_data()
    return bool(live.get("session_active")) and live_snapshot_is_fresh(live)


def ensure_stop_server():
    global SESSION_STOP_SERVER
    if SESSION_STOP_SERVER is not None:
        return SESSION_STOP_SERVER

    class StopHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            prefix = "/focusmate-stop/"
            request_path = self.path.partition("?")[0]
            key = request_path.removeprefix(prefix)
            if request_path.startswith(prefix) and re.fullmatch(r"[a-f0-9]{32}", key):
                data_directory = os.path.join(PROFILE_DIR, key)
                try:
                    os.makedirs(data_directory, exist_ok=True)
                    stop_path = os.path.join(data_directory, "stop_session.request")
                    with open(stop_path, "w", encoding="utf-8") as file:
                        file.write("stop")
                    mark_session_closed(os.path.join(data_directory, "session_closed.marker"))
                except Exception:
                    try:
                        mark_session_closed()
                    except Exception:
                        pass
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"ok")
                return
            self.send_response(404)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

        def log_message(self, format, *args):
            return

    server = HTTPServer(("127.0.0.1", SESSION_STOP_PORT), StopHandler)
    SESSION_STOP_SERVER = server
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def start_webcam():
    if webcam_is_running() or webcam_session_active():
        return True, "Your study session is already running."
    if not load_profile().get("session_preferences", {}).get("focus_monitoring", True):
        return False, "Webcam monitoring is turned off in your session preferences."
    if not os.path.isfile(WEBCAM_FILE):
        return False, f"Webcam detector not found: {WEBCAM_FILE}"
    if not os.path.isfile(WEBCAM_PYTHON):
        return False, (
            "The configured webcam Python executable was not found. "
            "Set FOCUSMATE_WEBCAM_PYTHON to a valid Python 3.12/3.13 executable."
        )

    try:
        check = subprocess.run(
            [WEBCAM_PYTHON, "-c", "import cv2, mediapipe"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f"Could not check the webcam environment: {error}"
    if check.returncode != 0:
        return False, (
            "MediaPipe and OpenCV are not available in the selected webcam "
            f"Python environment.\n\n{check.stderr[-1500:]}"
        )

    stop_path = user_data_file("stop_session.request")
    if os.path.exists(stop_path):
        try:
            os.remove(stop_path)
        except OSError as error:
            return False, f"Could not clear the previous stop request: {error}"
    try:
        worker_env = os.environ.copy()
        worker_env["FOCUSMATE_SESSION_FILE"] = user_data_file("session_data.json")
        worker_env["FOCUSMATE_PROFILE_FILE"] = profile_file()
        worker_env["FOCUSMATE_FRAME_FILE"] = user_data_file("latest_frame.jpg")
        worker_env["FOCUSMATE_STOP_FILE"] = stop_path
        st.session_state.webcam_process = subprocess.Popen(
            [WEBCAM_PYTHON, WEBCAM_FILE], cwd=WEBCAM_DIR, env=worker_env
        )
        st.session_state.webcam_start_time = datetime.now()
    except OSError as error:
        return False, f"Could not start the webcam detector: {error}"
    return True, "Your webcam study session has started."


def stop_webcam():
    process = st.session_state.get("webcam_process")
    process_running = process is not None and process.poll() is None
    session_active = webcam_session_active()
    if not process_running and not session_active:
        return False, "There is no running webcam session to stop."

    try:
        with open(user_data_file("stop_session.request"), "w", encoding="utf-8") as file:
            file.write("stop")
    except OSError as error:
        return False, f"Could not stop the webcam detector: {error}"

    if process_running:
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            if sys.platform.startswith("win"):
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
            else:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    st.session_state.webcam_process = None
    st.session_state.webcam_start_time = None
    frame_path = user_data_file("latest_frame.jpg")
    if os.path.exists(frame_path):
        try:
            os.remove(frame_path)
        except OSError:
            pass
    stop_path = user_data_file("stop_session.request")
    if process is not None and os.path.exists(stop_path):
        try:
            os.remove(stop_path)
        except OSError:
            pass
    return True, "Session ended. Your progress has been saved."


def inject_exit_handler():
    ensure_stop_server()
    stop_url = f"http://127.0.0.1:{SESSION_STOP_PORT}/focusmate-stop/{hashlib.sha256(normalize_username(st.session_state.get('active_username')).encode('utf-8')).hexdigest()[:32]}"
    st.markdown(
        """
        <script>
        const stopUrl = '__STOP_URL__';
        let stopSent = false;
        const triggerStop = () => {
          if (stopSent) return;
          stopSent = true;
          try {
            const payload = 'stop';
            if (navigator.sendBeacon) {
              navigator.sendBeacon(stopUrl, payload);
              return;
            }
            fetch(stopUrl, { method: 'POST', mode: 'no-cors', keepalive: true, body: payload });
          } catch (error) {
            // ignore page-close cleanup errors
          }
        };
        window.addEventListener('pagehide', triggerStop);
        </script>
        """.replace("__STOP_URL__", stop_url),
        unsafe_allow_html=True,
    )


def inject_styles():
    st.markdown(
        """
        <style>
        :root {
            --ink: #f5f4f0; --muted: #a9b2c5; --mint: #a8f0d0;
            --lime: #d6f58a; --panel: rgba(23, 33, 48, .78);
            --line: rgba(193, 217, 220, .12);
        }
        html, body, [class*="css"] { font-family: 'Aptos', 'Segoe UI', sans-serif; }
        .stApp {
            color: var(--ink);
            background:
              radial-gradient(ellipse at 83% 0%, rgba(74, 123, 117, .20), transparent 32%),
              radial-gradient(ellipse at 5% 35%, rgba(80, 104, 92, .16), transparent 33%),
              linear-gradient(145deg, #111a24 0%, #111923 48%, #0d151e 100%);
        }
        [data-testid="stHeader"] { background: rgba(13, 21, 30, .65); }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #151f2a, #111922);
            border-right: 1px solid var(--line);
        }
        [data-testid="stSidebar"] > div:first-child { padding-top: 1rem; }
        .block-container { max-width: 1350px; padding-top: 2.2rem; padding-bottom: 4rem; }
        h1, h2, h3 { font-family: 'Aptos Display', 'Segoe UI', sans-serif; letter-spacing: -.035em; color: var(--ink); }
        h1 { font-weight: 800; }
        p, li, label { color: #d7deea; }
        [data-testid="stCaptionContainer"] p, .muted { color: var(--muted) !important; }
        [data-testid="stMetric"] {
            padding: 1.1rem 1.2rem; border-radius: 20px;
            border: 1px solid var(--line); background: var(--panel);
            box-shadow: 0 12px 40px rgba(0,0,0,.12);
            animation: rise-in .65s both;
        }
        [data-testid="stMetricLabel"] p { color: var(--muted) !important; font-size: .86rem; }
        [data-testid="stMetricValue"] { color: var(--ink) !important; font-family: 'Aptos Display','Segoe UI',sans-serif; }
        div[data-testid="stButton"] button {
            border-radius: 13px; border: 1px solid rgba(168,240,208,.25);
            background: rgba(168,240,208,.09); color: var(--ink);
            transition: transform .22s ease, box-shadow .22s ease, background .22s ease;
        }
        div[data-testid="stButton"] button:hover {
            transform: translateY(-2px); background: rgba(168,240,208,.17);
            box-shadow: 0 8px 24px rgba(82,190,151,.13); border-color: var(--mint);
        }
        div[data-testid="stButton"] button[kind="primary"] {
            color: #f5f4f0; border: 0;
            background: #0b0d11;
            font-weight: 700;
        }
        [data-testid="stProgressBar"] > div > div {
            background: linear-gradient(90deg, #81d8bd, #d6f58a);
            background-size: 180% 100%; animation: glow-shift 4s ease infinite;
        }
        [data-testid="stProgressBar"] > div { background: rgba(255,255,255,.09); }
        [data-testid="stTabs"] button { color: var(--muted); }
        [data-testid="stTabs"] button[aria-selected="true"] { color: var(--mint); }
        div[data-testid="stToggle"] > div > div > div > div > input[role="switch"] {
            background-color: rgba(255,255,255,.14);
            border: 1px solid rgba(255,255,255,.15);
        }
        div[data-testid="stToggle"] > div > div > div > div > input[role="switch"][aria-checked="true"] {
            background-color: #35d9a5 !important;
            border-color: #35d9a5 !important;
        }
        div[data-testid="stToggle"] > div > div > div > div > span {
            background-color: #ffffff;
        }
        [data-testid="stDataFrame"], [data-testid="stTable"] {
            border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
        }
        [data-testid="stForm"], [data-testid="stExpander"] {
            border-color: var(--line) !important; border-radius: 16px !important;
            background: rgba(23,33,48,.48);
        }
        [data-testid="stAlert"] { border-radius: 14px; }
        .brand-lockup { font: 800 1.2rem 'Aptos Display','Segoe UI',sans-serif; letter-spacing: -.05em; color: var(--ink); }
        .brand-lockup span { color: var(--mint); }
        .nav-greeting {
            margin: 0 0 1rem; padding: 1rem .9rem .9rem; border-radius: 18px;
            border: 1px solid rgba(168,240,208,.18); background: linear-gradient(135deg, rgba(26,39,48,.88), rgba(15,22,31,.78));
            box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 18px 35px rgba(10,18,24,.22);
            position: sticky; top: 0; z-index: 2;
        }
        .nav-greeting-kicker {
            color: var(--mint); font-size: .62rem; letter-spacing: .18em; text-transform: uppercase; font-weight: 700;
        }
        .nav-greeting-name {
            margin-top: .5rem; font-size: 1.7rem; line-height: 1.1; font-weight: 800; letter-spacing: -.06em; color: var(--ink);
            text-shadow: 0 0 22px rgba(168,240,208,.18);
        }
        .nav-greeting-handle {
            margin-top: .2rem; color: #b5c2d1; font-size: .8rem; letter-spacing: .04em;
        }
        .settings-shell {
            padding: 0.5rem 0 0;
        }
        .settings-header {
            display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.4rem;
        }
        .settings-badge {
            display: inline-flex; align-items: center; padding: .35rem .65rem; border-radius: 999px;
            background: rgba(168,240,208,.08); color: var(--mint); border: 1px solid rgba(168,240,208,.18);
            font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; font-weight: 700;
        }
        .settings-panel {
            padding: 1.1rem 1.3rem; background: rgba(17, 25, 34, 0.78); border: 1px solid rgba(193,217,220,.12); border-radius: 22px;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
        }
        .settings-panel h3 {
            margin: 0 0 0.9rem; font-size: 1.18rem; color: var(--ink);
        }
        .settings-row {
            display: flex; align-items: center; justify-content: space-between; gap: 1rem;
            padding: 1rem 0; border-top: 1px solid rgba(193,217,220,.08);
        }
        .settings-row:first-of-type { border-top: 0; }
        .settings-label {
            color: #dfe8f3; font-size: 1.05rem; line-height: 1.5;
        }
        .settings-caption {
            display: block; margin-top: .2rem; color: #8ea0b5; font-size: .88rem;
        }
        .profile-card {
            padding: 1.25rem 1.2rem; background: rgba(17, 25, 34, 0.82); border: 1px solid rgba(193,217,220,.12); border-radius: 20px; min-height: 100%;
        }
        .profile-card h3 { margin: 0 0 1.2rem; font-size: 1.25rem; }
        .profile-line {
            display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .7rem 0; border-top: 1px solid rgba(193,217,220,.08);
        }
        .profile-line:first-of-type { border-top: 0; }
        .profile-key { color: #9aa9bb; font-size: .98rem; }
        .profile-value { color: var(--ink); font-weight: 600; font-size: 1rem; }
        .welcome-shell {
            min-height: 84vh; display: grid; place-items: center; padding: 2rem 0 1rem;
        }
        .welcome-card {
            width: min(680px, 100%); padding: 2.2rem 2rem; border-radius: 32px;
            border: 1px solid rgba(193,217,220,.16); background: linear-gradient(135deg, rgba(38,56,57,.72), rgba(17,28,37,.88));
            box-shadow: 0 30px 80px rgba(0,0,0,.22); text-align: center; position: relative; overflow: hidden;
            animation: fade-up .76s ease both;
        }
        .welcome-card:before {
            content: ''; position: absolute; inset: -30% auto auto -10%; width: 260px; height: 260px; border-radius: 50%;
            background: rgba(168,240,208,.12); filter: blur(10px); animation: floaty 8s ease-in-out infinite alternate;
        }
        .welcome-card:after {
            content: ''; position: absolute; inset: auto -8% -30% auto; width: 240px; height: 240px; border-radius: 50%;
            background: rgba(214,245,138,.10); filter: blur(8px); animation: floaty 10s ease-in-out infinite alternate-reverse;
        }
        .welcome-badge {
            position: relative; display: inline-block; padding: .55rem .9rem; border-radius: 999px; border: 1px solid rgba(168,240,208,.35);
            background: rgba(168,240,208,.08); color: var(--mint); letter-spacing: .18em; text-transform: uppercase; font-size: .7rem; font-weight: 700;
        }
        .welcome-title {
            position: relative; margin: 1.2rem 0 .5rem; font-size: clamp(2.3rem, 5vw, 4.3rem); line-height: 1.05; font-weight: 800;
            color: var(--ink); letter-spacing: -.06em; animation: reveal 1.1s ease both;
        }
        .welcome-name {
            position: relative; display: inline-block; background: linear-gradient(90deg, #a8f0d0, #d6f58a, #dceef2, #a8f0d0);
            background-size: 220% 100%; color: transparent; -webkit-background-clip: text; background-clip: text; animation: name-shimmer 3s linear infinite;
            text-shadow: 0 0 26px rgba(168,240,208,.18);
        }
        .welcome-subtitle {
            position: relative; margin: 0 auto; max-width: 560px; color: #d2dbe6; font-size: 1.05rem; line-height: 1.7;
        }
        .welcome-form {
            position: relative; margin-top: 1.8rem; display: flex; flex-direction: column; gap: 1rem; align-items: center;
        }
        .welcome-form .stTextInput > div > div > input {
            min-height: 3.2rem; border-radius: 14px; background: rgba(10,17,23,.45); border: 1px solid rgba(193,217,220,.12);
            color: var(--ink); font-size: 1.05rem; box-shadow: 0 0 0 rgba(0,0,0,0);
        }
        .welcome-actions { position: relative; margin-top: .6rem; }
        .welcome-actions .stButton > button {
            min-width: 230px; border-radius: 999px; border: none; font-weight: 700; padding: .8rem 1.5rem;
            background: linear-gradient(90deg, #a8f0d0, #d6f58a); color: #0d151e; box-shadow: 0 18px 35px rgba(168,240,208,.2);
        }
        .eyebrow { color: var(--mint); font-size: .72rem; font-weight: 700; letter-spacing: .17em; text-transform: uppercase; }
        .hero {
            position: relative; overflow: hidden; padding: 2rem 2.1rem; margin-bottom: 1.2rem;
            border: 1px solid rgba(193,217,220,.15); border-radius: 26px;
            background: linear-gradient(118deg, rgba(58,91,81,.53), rgba(29,53,60,.42) 56%, rgba(37,48,61,.7));
            box-shadow: 0 24px 70px rgba(0,0,0,.17); animation: rise-in .72s both;
        }
        .hero:after {
            content: ''; position: absolute; width: 260px; height: 260px; right: -60px; top: -140px;
            border-radius: 50%; background: rgba(168,240,208,.14); filter: blur(1px);
            box-shadow: 0 0 80px rgba(168,240,208,.16);
            animation: drift 8s ease-in-out infinite alternate;
        }
        .hero h1 { margin: .5rem 0 .4rem; font-size: clamp(2rem, 4vw, 3.35rem); }
        .hero p { max-width: 640px; color: #c0cbd6; font-size: 1.03rem; margin: 0; line-height: 1.65; }
        .surface {
            padding: 1.25rem 1.35rem; border-radius: 20px; border: 1px solid var(--line);
            background: var(--panel); height: 100%;
            transition: transform .24s ease, border-color .24s ease, box-shadow .24s ease;
            animation: rise-in .72s both;
        }
        .surface:hover { transform: translateY(-4px); border-color: rgba(168,240,208,.29); box-shadow: 0 18px 36px rgba(0,0,0,.18); }
        .surface h3 { margin: .1rem 0 .6rem; font-size: 1.07rem; }
        .surface p { color: var(--muted); line-height: 1.6; }
        .stat-card {
            padding: 1rem 1.05rem; height: 126px; border-radius: 19px;
            border: 1px solid var(--line); background: var(--panel);
            box-shadow: 0 12px 40px rgba(0,0,0,.12); animation: rise-in .65s both;
        }
        .stat-label { color: var(--muted); font-size: .82rem; }
        .stat-value {
            overflow-wrap: anywhere; margin: .45rem 0 .25rem;
            color: var(--ink); font: 750 clamp(1.2rem, 1.8vw, 1.65rem)/1.1 'Aptos Display','Segoe UI',sans-serif;
        }
        .stat-note { color: #94a2b3; font-size: .76rem; }
        .timer {
            font: 800 clamp(3.4rem, 12vw, 6.6rem)/1 'Aptos Display','Segoe UI',sans-serif;
            letter-spacing: -.08em; text-align: center; padding: 1.7rem 0 .9rem;
            color: var(--ink); text-shadow: 0 0 34px rgba(168,240,208,.13);
            font-variant-numeric: tabular-nums;
        }
        .timer.running { animation: timer-breathe 3s ease-in-out infinite alternate; }
        .quest-card {
            padding: 1.05rem 1.2rem; margin: .55rem 0; border: 1px solid var(--line);
            border-radius: 17px; background: rgba(23,33,48,.68);
            transition: transform .22s ease, border-color .22s ease;
            animation: rise-in .55s both;
        }
        .quest-card:hover { transform: translateX(4px); border-color: rgba(168,240,208,.32); }
        .xp-pill { color: var(--lime); font-weight: 700; font-size: .88rem; }
        .divider-label { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .14em; }
        @keyframes rise-in { from { opacity: 0; transform: translateY(13px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes drift { from { transform: translate(0,0); } to { transform: translate(-20px,18px); } }
        @keyframes glow-shift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(20px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes reveal { from { opacity: 0; transform: translateY(12px); filter: blur(8px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }
        @keyframes floaty { from { transform: translateY(0) translateX(0); } to { transform: translateY(-18px) translateX(16px); } }
        @keyframes name-shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes timer-breathe { to { transform: scale(1.02); } }
        @media (prefers-reduced-motion: reduce) {
            *, *:before, *:after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
        }
        @media (max-width: 760px) { .stat-card { height: auto; min-height: 112px; } }
        </style>
        """,
        unsafe_allow_html=True,
    )


def welcome_intro_form():
    generation = int(st.session_state.get("login_form_generation", 0))
    st.markdown(
        """
        <div class="welcome-shell">
          <div class="welcome-card">
            <div class="welcome-badge">FocusMate</div>
            <h1 class="welcome-title">Welcome</h1>
            <p class="welcome-subtitle">A calm study space built for your next focused hour. Sign in with your username or create a new local profile.</p>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    with st.form("welcome_form", clear_on_submit=False):
        st.markdown('<div class="welcome-form">', unsafe_allow_html=True)
        name = st.text_input(
            "Your name (new profiles)",
            placeholder="Enter a name when creating a profile...",
            max_chars=40,
            key=f"welcome_name_{generation}",
        )
        username = st.text_input(
            "Username",
            placeholder="Your saved username...",
            max_chars=32,
            key=f"welcome_username_{generation}",
        )
        submitted = st.form_submit_button("Continue", type="primary")
        st.markdown('</div>', unsafe_allow_html=True)
    st.caption("Existing usernames reopen their saved progress. New usernames create a separate profile on this computer.")

    if submitted:
        cleaned_username = normalize_username(username)
        if not cleaned_username:
            st.error("Enter a username using letters, numbers, dots, dashes, or underscores.")
            return

        existing_profile = profile_exists(cleaned_username)
        if existing_profile:
            profile = load_profile(cleaned_username)
            cleaned_name = str(profile.get("player_name") or "Focus friend").strip()
        else:
            cleaned_name = (name or "").strip()
            if not cleaned_name:
                st.error("Enter your name to create a new profile.")
                return
            profile = fresh_profile(cleaned_username)
            profile["player_name"] = cleaned_name

        st.session_state.active_username = cleaned_username
        st.session_state.login_form_generation = generation + 1
        st.session_state.welcome_name = cleaned_name
        st.session_state.welcome_username = cleaned_username
        st.session_state.welcome_step = "animation"
        st.session_state.welcome_started_at = time.time()
        profile["username"] = cleaned_username
        save_profile(profile, cleaned_username)
        st.rerun()


def welcome_animation():
    name = str(st.session_state.get("welcome_name") or "Focus friend").strip() or "Focus friend"
    start_time = float(st.session_state.get("welcome_started_at") or time.time())
    elapsed = time.time() - start_time

    st.markdown(
        f"""
        <div class="welcome-shell">
          <div class="welcome-card">
            <div class="welcome-badge">FocusMate</div>
            <h1 class="welcome-title">Welcome, <span class="welcome-name">{html.escape(name)}</span></h1>
            <p class="welcome-subtitle">Your study space is ready. Take a breath, pick one task, and let the next focused session begin.</p>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if elapsed >= 2.0:
        st.session_state.welcome_step = "main"
        st.rerun()


def render_brand(profile):
    name = str(profile.get("player_name") or "Focus friend").strip() or "Focus friend"
    username = str(profile.get("username") or "focusfriend").strip() or "focusfriend"
    st.sidebar.markdown(
        f"""
        <div class="nav-greeting">
          <div class="nav-greeting-kicker">Welcome back</div>
          <div class="nav-greeting-name">{html.escape(name)}</div>
          <div class="nav-greeting-handle">@{html.escape(username)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.sidebar.markdown(
        '<div class="brand-lockup">focus<span>mate</span> ✳</div>',
        unsafe_allow_html=True,
    )
    xp = max(0, int(profile.get("total_xp", 0) or 0))
    level = xp // LEVEL_STEP + 1
    st.sidebar.markdown(f"**Level {level}** · {xp:,} lifetime XP")
    st.sidebar.progress((xp % LEVEL_STEP) / LEVEL_STEP)
    st.sidebar.caption(f"{LEVEL_STEP - (xp % LEVEL_STEP)} XP to your next level")
    st.sidebar.divider()
    if st.sidebar.button(
        "Switch profile",
        width="stretch",
        disabled=webcam_session_active() or st.session_state.get("focus_running", False),
        help="Pause the focus timer and end the webcam session before switching profiles.",
    ):
        st.session_state.active_username = None
        st.session_state.welcome_step = "form"
        st.session_state.login_form_generation = int(
            st.session_state.get("login_form_generation", 0)
        ) + 1
        for key in (
            "focus_duration",
            "focus_remaining",
            "focus_deadline",
            "focus_running",
            "focus_finished",
            "focus_preference_seen",
            "pending_session_chime",
        ):
            st.session_state.pop(key, None)
        st.rerun()
    st.sidebar.caption("Progress, not perfection. Take care of yourself.")


def page_header(kicker, title, description):
    st.markdown(
        f'<div class="eyebrow">{kicker}</div><h1 style="margin:.25rem 0 .45rem">{title}</h1>',
        unsafe_allow_html=True,
    )
    st.markdown(f'<p class="muted">{description}</p>', unsafe_allow_html=True)


def stat_card(label, value, note):
    st.markdown(
        f'<div class="stat-card"><div class="stat-label">{html.escape(label)}</div>'
        f'<div class="stat-value">{html.escape(str(value))}</div>'
        f'<div class="stat-note">{html.escape(note)}</div></div>',
        unsafe_allow_html=True,
    )


def hero(name, xp_to_next):
    st.markdown(
        f"""
        <section class="hero">
          <div class="eyebrow">YOUR PERSONAL STUDY SPACE</div>
          <h1>Make room for your best work, {html.escape(name)}.</h1>
          <p>Small, steady sessions add up. Settle in, choose one thing to focus on,
             and remember that breaks are part of the plan.</p>
          <div style="margin-top:1.2rem;color:#c4d4d2;font-size:.9rem">
            ✦ &nbsp; Just {xp_to_next} XP until your next level
          </div>
        </section>
        """,
        unsafe_allow_html=True,
    )


def render_live_camera_preview():
    frame_path = user_data_file("latest_frame.jpg")
    if not os.path.exists(frame_path):
        st.markdown(
            '<div style="height:240px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(193,217,220,.12);border-radius:18px;background:rgba(17,25,34,.65);color:#aab7c7;font-weight:600;">Camera off</div>',
            unsafe_allow_html=True,
        )
        return
    try:
        from PIL import Image
        image = Image.open(frame_path)
        st.image(image, use_container_width=True)
    except Exception:
        try:
            st.image(frame_path, use_container_width=True)
        except Exception:
            st.markdown(
                '<div style="height:240px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(193,217,220,.12);border-radius:18px;background:rgba(17,25,34,.65);color:#aab7c7;font-weight:600;">Camera off</div>',
                unsafe_allow_html=True,
            )


def mood_prompt_required(profile):
    prefs = profile.get("session_preferences") or {}
    if not prefs.get("mood_checkins", True):
        return False
    wellbeing = profile.get("session_wellbeing") or {}
    return wellbeing.get("mood_checkin_date") != date.today().isoformat()


def render_webcam_controls(live, profile):
    running = webcam_is_running()
    active = webcam_session_active()
    fresh = live_snapshot_is_fresh(live, max_age=20)
    prefs = {**fresh_profile()["session_preferences"], **profile.get("session_preferences", {})}
    wellbeing = profile.get("session_wellbeing") or {}
    mood_prompt = mood_prompt_required(profile)
    selected_mood = "Choose a mood"
    if not running and not active:
        if not prefs.get("focus_monitoring", True):
            st.info("Webcam monitoring is off. Turn it on in Session preferences to start a camera session.")
            render_live_camera_preview()
            return

        st.info("Ready when you are. The camera only starts when you choose.")
        if mood_prompt:
            selected_mood = st.selectbox(
                "How are you feeling before this session?",
                ["Choose a mood", "Calm", "Focused", "Okay", "Tired", "Stressed"],
                key=f"mood_checkin_{normalize_username(profile.get('username'))}_{date.today().isoformat()}",
            )
        cam_button_label = "📷 Start camera"
        if st.button(
            cam_button_label,
            type="primary",
            width="stretch",
            disabled=mood_prompt and selected_mood == "Choose a mood",
        ):
            if mood_prompt:
                latest = load_profile()
                latest_wellbeing = latest.get("session_wellbeing") or {}
                latest_wellbeing.update({
                    "mood": selected_mood,
                    "mood_checkin_date": date.today().isoformat(),
                    "mood_updated_at": datetime.now().isoformat(),
                })
                latest["session_wellbeing"] = latest_wellbeing
                save_profile(latest)
            ok, message = start_webcam()
            (st.success if ok else st.error)(message)
            st.rerun()
        if active and fresh:
            st.success("Live connection · your study buddy is checking in.")
        elif active:
            st.warning("The latest camera update is delayed. Check that the detector is still running.")
        else:
            st.caption("No active camera session. Your focus timer works independently.")
        render_live_camera_preview()
        return

    st.success("Your webcam session is running.")
    if st.button("🛑 Stop camera", type="primary", width="stretch"):
        ok, message = stop_webcam()
        (st.success if ok else st.warning)(message)
        st.rerun()

    if not os.path.exists(user_data_file("latest_frame.jpg")):
        st.markdown(
            '<div style="height:240px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(193,217,220,.12);border-radius:18px;background:rgba(17,25,34,.65);color:#aab7c7;font-weight:600;">Camera off</div>',
            unsafe_allow_html=True,
        )
    else:
        render_live_camera_preview()

    attention = bounded_int(live.get("focus_score"), 0, 0, 100)
    distraction = max(0, 100 - attention)
    posture_value = 100 if str(live.get("posture") or "Unknown").strip() == "Good" else 0 if str(live.get("posture") or "Unknown").strip() == "Slouching" else 50
    face_value = 100 if bool(live.get("face_detected")) else 0
    bars = [
        ("Attention", attention),
        ("Distraction", distraction),
        ("Posture", posture_value),
        ("Face detected", face_value),
    ]
    for label, value in bars:
        st.progress(min(100, max(0, value)) / 100.0, text=f"{label}: {value}%")

    if active and fresh:
        st.success("Live connection · your study buddy is checking in.")
        if prefs.get("posture_alerts", True) and str(live.get("posture") or "Unknown").strip() == "Slouching":
            st.warning("Your posture looks uncomfortable. Try relaxing your shoulders or adjusting your seat.")
    elif active:
        st.warning("The latest camera update is delayed. Check that the detector is still running.")
    else:
        st.caption("No active camera session. Your focus timer works independently.")


def render_overview(profile, live):
    xp = max(0, int(profile.get("total_xp", 0) or 0))
    level = xp // LEVEL_STEP + 1
    xp_into_level = xp % LEVEL_STEP
    xp_to_next = LEVEL_STEP - xp_into_level
    minutes = max(0, int(profile.get("total_study_seconds", 0) or 0)) // 60
    history = profile["session_history"]
    water_today = int(profile.get("water_glasses_today", 0) or 0)
    hero(str(profile.get("player_name") or "Focus friend").strip(), xp_to_next)

    a, b, c, d, e = st.columns(5, gap="small")
    with a:
        stat_card("Your level", f"Level {level}", f"{xp_into_level} / {LEVEL_STEP} XP")
    with b:
        stat_card("Lifetime XP", f"{xp:,}", "From study & quests")
    with c:
        stat_card("Study time", f"{minutes // 60}h {minutes % 60:02d}m", "Across sessions")
    with d:
        stat_card("Sessions", int(profile.get("sessions_completed", 0) or 0), "Completed")
    with e:
        stat_card("Water today", f"{water_today} 🥤", "Glasses")
    st.progress(xp_into_level / LEVEL_STEP, text=f"{xp_to_next} XP to Level {level + 1}")
    preferences = profile.get("session_preferences", {})
    daily_goal_seconds = max(1, int(preferences.get("daily_goal_minutes", 180) or 180)) * 60
    today_seconds = sum(
        item["seconds"]
        for item in normalized_history(profile)
        if item["date"] == date.today()
    )
    if live.get("session_active") and live_snapshot_is_fresh(live):
        try:
            today_seconds += max(0, int(float(live.get("session_seconds", 0) or 0)))
        except (TypeError, ValueError):
            pass
    st.progress(
        min(1.0, today_seconds / daily_goal_seconds),
        text=f"Today's goal · {today_seconds // 60} of {daily_goal_seconds // 60} minutes",
    )
    water_row = st.columns([1, 2])
    with water_row[0]:
        if st.button("+ Glass of water", use_container_width=True):
            updated = load_profile()
            if str(updated.get("water_glasses_last_reset") or "") != date.today().isoformat():
                updated["water_glasses_today"] = 0
                updated["water_glasses_last_reset"] = date.today().isoformat()
            updated["water_glasses_today"] = int(updated.get("water_glasses_today", 0) or 0) + 1
            updated["session_wellbeing"] = updated.get("session_wellbeing") or {}
            updated["session_wellbeing"]["water_glasses"] = updated["water_glasses_today"]
            save_profile(updated)
            st.rerun()
    with water_row[1]:
        st.caption(f"Current count: {water_today} glass(es) today")

    st.write("")
    left, right = st.columns([1.15, .85], gap="large")
    with left:
        st.markdown('<div class="divider-label">A good place to begin</div>', unsafe_allow_html=True)
        st.subheader("One thing at a time.")
        st.markdown(
            "Pick one small task, set a comfortable timer, and let the rest wait. "
            "Your session is yours to shape."
        )
        st.markdown(
            '<div class="surface"><h3>🌱 Gentle reminder</h3>'
            '<p>Camera signals can be imperfect. They are optional prompts—not a score, '
            'grade, diagnosis, or measure of your effort.</p></div>',
            unsafe_allow_html=True,
        )
    with right:
        st.markdown('<div class="divider-label">Your study buddy</div>', unsafe_allow_html=True)
        st.subheader("Check in")
        render_webcam_controls(live, profile)
        posture = str(live.get("posture") or "Waiting for data")
        distance = str(live.get("distance_status") or "Not measured")
        status = str(live.get("status") or "Waiting for webcam")
        st.markdown(
            f'<div class="surface"><div class="eyebrow">LATEST SIGNALS</div>'
            f'<h3 style="margin-top:.7rem">{html.escape(status)}</h3>'
            f'<p>Posture: {html.escape(posture)}<br>Distance: {html.escape(distance)}</p>'
            f'<p style="font-size:.78rem">Last update: {html.escape(str(live.get("last_updated") or "Not yet received"))}</p></div>',
            unsafe_allow_html=True,
        )

    st.write("")
    st.subheader("A few ways to recharge")
    cards = st.columns(3)
    tips = [
        ("👀", "Rest your eyes", "Look into the distance and blink naturally. A blink is never a mistake."),
        ("🧍", "Move a little", "Relax your shoulders, stretch, or adjust your seat."),
        ("💧", "Take a sip", "Water and short pauses belong in a sustainable study routine."),
    ]
    for column, (icon, title, body) in zip(cards, tips):
        with column:
            st.markdown(
                f'<div class="surface"><h3>{icon} &nbsp;{title}</h3><p>{body}</p></div>',
                unsafe_allow_html=True,
            )

    if history:
        latest = history[-1]
        try:
            latest_minutes = max(0, int(latest.get("seconds", 0))) // 60
        except (TypeError, ValueError):
            latest_minutes = 0
        st.write("")
        st.caption(
            f"Your latest saved session: {latest_minutes} minutes · "
            f"{latest.get('date', 'date not available')}"
        )


def render_pending_session_chime(profile):
    kind = st.session_state.pop("pending_session_chime", None)
    if kind not in {"start", "complete"}:
        return
    if not profile.get("session_preferences", {}).get("session_chimes", False):
        return

    sample_rate = 22050
    note_duration = 0.18
    notes = (587.33, 783.99) if kind == "start" else (783.99, 587.33)
    frames = bytearray()
    for index in range(int(sample_rate * note_duration * len(notes))):
        elapsed = index / sample_rate
        note_index = min(int(elapsed / note_duration), len(notes) - 1)
        note_time = elapsed - note_index * note_duration
        envelope = min(1.0, note_time / 0.01, (note_duration - note_time) / 0.035)
        sample = int(5000 * max(0.0, envelope) * math.sin(2 * math.pi * notes[note_index] * note_time))
        frames.extend(struct.pack("<h", sample))

    audio = io.BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(frames)
    st.audio(audio.getvalue(), format="audio/wav", autoplay=True, width="content")


def render_pending_posture_beep(profile, live):
    token = live.get("posture_beep_token")
    if token is None:
        return
    if not profile.get("session_preferences", {}).get("posture_alerts", True):
        return
    last_token = st.session_state.get("last_posture_beep_token")
    if last_token == token:
        return
    st.session_state.last_posture_beep_token = token

    sample_rate = 22050
    note_duration = 0.22
    notes = (220.0, 180.0)
    frames = bytearray()
    for index in range(int(sample_rate * note_duration * len(notes))):
        elapsed = index / sample_rate
        note_index = min(int(elapsed / note_duration), len(notes) - 1)
        note_time = elapsed - note_index * note_duration
        envelope = min(1.0, note_time / 0.01, (note_duration - note_time) / 0.04)
        sample = int(7000 * max(0.0, envelope) * math.sin(2 * math.pi * notes[note_index] * note_time))
        frames.extend(struct.pack("<h", sample))

    audio = io.BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(frames)
    st.audio(audio.getvalue(), format="audio/wav", autoplay=True, width="content")


def timer_controls(profile):
    st.markdown('<div class="divider-label">A calm little Pomodoro</div>', unsafe_allow_html=True)
    durations = {"15 min": 15, "25 min": 25, "45 min": 45, "60 min": 60}
    preferences = profile.get("session_preferences", {})
    default_duration = max(15, min(120, int(preferences.get("session_length_minutes", 25) or 25)))
    if default_duration not in durations.values():
        durations[f"{default_duration} min"] = default_duration
    if "focus_duration" not in st.session_state:
        st.session_state.focus_duration = default_duration
        st.session_state.focus_remaining = default_duration * 60
        st.session_state.focus_deadline = None
        st.session_state.focus_running = False
        st.session_state.focus_finished = False
        st.session_state.focus_preference_seen = default_duration
    elif (
        not st.session_state.focus_running
        and st.session_state.get("focus_preference_seen") != default_duration
    ):
        st.session_state.focus_duration = default_duration
        st.session_state.focus_remaining = default_duration * 60
        st.session_state.focus_finished = False
        st.session_state.focus_preference_seen = default_duration
    if st.session_state.focus_duration not in durations.values():
        durations[f"{st.session_state.focus_duration} min"] = st.session_state.focus_duration

    selected_label = st.selectbox(
        "Choose a focus block",
        list(durations),
        index=list(durations.values()).index(st.session_state.focus_duration),
        disabled=st.session_state.focus_running,
        key=f"focus_duration_{normalize_username(profile.get('username'))}",
    )
    selected_duration = durations[selected_label]
    if selected_duration != st.session_state.focus_duration and not st.session_state.focus_running:
        st.session_state.focus_duration = selected_duration
        st.session_state.focus_remaining = selected_duration * 60
        st.session_state.focus_finished = False

    if st.session_state.focus_running:
        remaining = max(0, int(st.session_state.focus_deadline - time.time()))
        st.session_state.focus_remaining = remaining
        if remaining == 0:
            st.session_state.focus_running = False
            st.session_state.focus_deadline = None
            st.session_state.focus_finished = True
            if preferences.get("session_chimes", False):
                st.session_state.pending_session_chime = "complete"
            st.toast("Focus block complete. Take a little break—you earned it.")
    else:
        remaining = int(st.session_state.focus_remaining)
    minutes, seconds = divmod(remaining, 60)
    timer_state = " running" if st.session_state.focus_running else ""
    st.markdown(
        f'<div class="timer{timer_state}" aria-label="Timer: {minutes} minutes and {seconds} seconds">'
        f'{minutes:02d}:{seconds:02d}</div>',
        unsafe_allow_html=True,
    )
    total = st.session_state.focus_duration * 60
    st.progress(1 - (remaining / total), text="A steady pace is a good pace")

    start_col, pause_col, reset_col = st.columns(3)
    with start_col:
        if st.button(
            "Resume" if not st.session_state.focus_running and remaining < total else "Start focus",
            type="primary",
            width="stretch",
            disabled=st.session_state.focus_running or remaining == 0,
        ):
            st.session_state.focus_deadline = time.time() + remaining
            st.session_state.focus_running = True
            st.session_state.focus_finished = False
            if preferences.get("session_chimes", False):
                st.session_state.pending_session_chime = "start"
            st.rerun()
    with pause_col:
        if st.button("Pause", width="stretch", disabled=not st.session_state.focus_running):
            st.session_state.focus_remaining = max(
                0, int(st.session_state.focus_deadline - time.time())
            )
            st.session_state.focus_running = False
            st.session_state.focus_deadline = None
            st.rerun()
    with reset_col:
        if st.button("Reset", width="stretch"):
            st.session_state.focus_running = False
            st.session_state.focus_deadline = None
            st.session_state.focus_remaining = st.session_state.focus_duration * 60
            st.session_state.focus_finished = False
            st.rerun()
    if st.session_state.focus_finished:
        st.success("Block complete. Stretch, get some water, or celebrate your progress.")
    else:
        st.caption("This timer is a gentle guide; it does not control or record webcam sessions.")


def render_tasks(profile):
    username = normalize_username(profile.get("username"))
    st.subheader("Your small-step list")
    st.caption("Keep it light: a few clear next steps are plenty.")
    with st.form(f"add_task_form_{username}", clear_on_submit=True):
        new_task = st.text_input(
            "Add a task",
            placeholder="e.g. Review chapter two",
            max_chars=120,
            key=f"new_task_{username}",
        )
        submitted = st.form_submit_button("Add to my list")
    if submitted:
        if new_task.strip():
            latest = load_profile()
            tasks = latest["tasks"]
            tasks.append({"id": str(time.time_ns()), "text": new_task.strip(), "done": False})
            latest["tasks"] = tasks[-100:]
            save_profile(latest)
            st.rerun()
        st.warning("Write a task before adding it.")

    tasks = profile["tasks"]
    if not tasks:
        st.info("Your list is clear. Add one small next step when you're ready.")
        return
    for task in tasks:
        task_id = str(task.get("id", ""))
        task_text = str(task.get("text", ""))
        checked = st.checkbox(
            task_text,
            value=bool(task.get("done", False)),
            key=f"task_{username}_{task_id}",
        )
        if checked != bool(task.get("done", False)):
            latest = load_profile()
            for saved_task in latest["tasks"]:
                if str(saved_task.get("id")) == task_id:
                    saved_task["done"] = checked
                    break
            save_profile(latest)
            st.rerun()
    if st.button("Clear completed tasks"):
        latest = load_profile()
        latest["tasks"] = [task for task in latest["tasks"] if not task.get("done")]
        save_profile(latest)
        st.rerun()


def render_focus(profile, live):
    page_header(
        "FOCUS ROOM",
        "Settle in. Start small.",
        "A distraction-friendly space for one task, one timer, and a little breathing room.",
    )
    timer_col, session_col = st.columns([1.15, .85], gap="large")
    with timer_col:
        with st.container(border=True):
            timer_controls(profile)
    with session_col:
        st.markdown('<div class="divider-label">OPTIONAL CAMERA SESSION</div>', unsafe_allow_html=True)
        st.subheader("Study buddy")
        st.markdown(
            "Turn on webcam tracking only if it feels useful. You can use the focus timer and "
            "task list without enabling the camera."
        )
        render_webcam_controls(live, profile)
        st.caption(
            "Camera estimates are guidance only, not grades or medical advice. "
            "You can stop a session at any time."
        )
    st.write("")
    render_tasks(profile)


def normalized_history(profile):
    rows = []
    for entry in profile["session_history"]:
        if not isinstance(entry, dict):
            continue
        try:
            when = datetime.fromisoformat(str(entry.get("date", ""))).date()
            seconds = max(0, int(entry.get("seconds", 0)))
            xp = max(0, int(entry.get("xp", 0)))
        except (TypeError, ValueError):
            continue
        rows.append({"date": when, "seconds": seconds, "xp": xp})
    return rows


def render_insights(profile, live):
    page_header(
        "YOUR JOURNEY",
        "Progress you can feel good about.",
        "A gentle look back at time spent showing up—not a scorecard.",
    )
    rows = normalized_history(profile)
    total_sessions = int(profile.get("sessions_completed", 0) or 0)
    average = (
        sum(item["seconds"] for item in rows) / len(rows) / 60 if rows else 0
    )
    a, b, c = st.columns(3)
    a.metric("Sessions saved", total_sessions)
    b.metric("Average session", f"{average:.0f} min")
    c.metric("This week", f"{sum(item['seconds'] for item in rows if item['date'] >= date.today() - timedelta(days=6)) // 60} min")

    st.write("")
    chart_col, signal_col = st.columns([1.2, .8], gap="large")
    with chart_col:
        st.subheader("Study minutes · last 7 days")
        start = date.today() - timedelta(days=6)
        daily = {start + timedelta(days=offset): 0 for offset in range(7)}
        for item in rows:
            if item["date"] in daily:
                daily[item["date"]] += item["seconds"]
        daily = {day: seconds // 60 for day, seconds in daily.items()}
        chart_data = pd.DataFrame(
            {"Study minutes": list(daily.values())},
            index=[day.strftime("%a") for day in daily],
        )
        st.bar_chart(chart_data, color="#a8f0d0", width="stretch")
    with signal_col:
        st.subheader("Current session")
        live_history = live.get("history", [])
        if isinstance(live_history, list) and live_history:
            points = []
            for item in live_history:
                if isinstance(item, dict):
                    try:
                        points.append(
                            {
                                "Minute": float(item.get("minute", 0)),
                                "Focus estimate": float(item.get("focus_score", 0)),
                            }
                        )
                    except (TypeError, ValueError):
                        continue
            if points:
                st.line_chart(
                    pd.DataFrame(points).set_index("Minute"),
                    color="#d6f58a",
                    width="stretch",
                )
            else:
                st.info("Focus estimates will appear here during a webcam session.")
        else:
            st.info("Start an optional webcam session to see gentle, live focus estimates.")
        st.caption("Focus estimates fluctuate and can be inaccurate. They are not a grade.")

    st.write("")
    st.subheader("Your saved sessions")
    if not rows:
        st.markdown(
            '<div class="surface"><h3>Your story starts whenever you do ✨</h3>'
            '<p>Complete a webcam study session to see it reflected here. Your timer can be used on its own.</p></div>',
            unsafe_allow_html=True,
        )
        return
    display_rows = []
    for item in reversed(rows[-50:]):
        display_rows.append(
            {
                "Date": item["date"].strftime("%b %d, %Y"),
                "Study time": f"{item['seconds'] // 60} min",
                "XP earned": item["xp"],
            }
        )
    st.dataframe(pd.DataFrame(display_rows), width="stretch", hide_index=True)
    csv = pd.DataFrame(display_rows).to_csv(index=False).encode("utf-8")
    st.download_button(
        "Download session history (CSV)",
        data=csv,
        file_name="focusmate-session-history.csv",
        mime="text/csv",
    )


def quest_is_claimed(profile, quest_id):
    today = date.today().isoformat()
    return any(
        isinstance(item, dict)
        and item.get("quest_id") == quest_id
        and item.get("date") == today
        for item in profile["quest_claims"]
    )


def sprint_is_unlocked(profile, live):
    live_seconds = live.get("session_seconds", 0)
    try:
        live_seconds = int(float(live_seconds or 0))
    except (TypeError, ValueError):
        live_seconds = 0
    live_sprint_complete = (
        bool(live.get("session_active"))
        and live_snapshot_is_fresh(live)
        and live_seconds >= 900
    )
    return live_sprint_complete or any(
        item["seconds"] >= 900 for item in normalized_history(profile)
    )


def render_quests(profile, live):
    page_header(
        "DAILY QUESTS",
        "Tiny wins count.",
        "Optional, kind-to-yourself challenges. Claim a quest once per day for a little bonus XP.",
    )
    claims_today = sum(quest_is_claimed(profile, quest["id"]) for quest in QUESTS)
    st.progress(claims_today / len(QUESTS), text=f"{claims_today} of {len(QUESTS)} quests claimed today")
    unlocked_sprint = sprint_is_unlocked(profile, live)

    for quest in QUESTS:
        claimed = quest_is_claimed(profile, quest["id"])
        available = quest["id"] != "focus_sprint" or unlocked_sprint
        st.markdown(
            f'<div class="quest-card"><span style="font-size:1.4rem">{quest["icon"]}</span>'
            f' &nbsp; <b>{quest["title"]}</b><span class="xp-pill" style="float:right">+{quest["reward"]} XP</span>'
            f'<p style="margin:.45rem 0 0 2.25rem;color:#a9b2c5">{quest["description"]}</p></div>',
            unsafe_allow_html=True,
        )
        if claimed:
            st.caption("Completed today · your bonus has been added")
        elif not available:
            st.caption("Complete a 15-minute study session to unlock this quest.")
        elif st.button(
            f"Claim {quest['reward']} XP",
            key=f"claim_{normalize_username(profile.get('username'))}_{quest['id']}",
            disabled=not available,
        ):
            latest = load_profile()
            if quest_is_claimed(latest, quest["id"]):
                st.info("This quest has already been claimed today.")
            else:
                latest["total_xp"] = max(0, int(latest.get("total_xp", 0) or 0)) + quest["reward"]
                claims = latest["quest_claims"]
                claims.append(
                    {
                        "quest_id": quest["id"],
                        "date": date.today().isoformat(),
                        "xp": quest["reward"],
                        "claimed_at": datetime.now().isoformat(),
                    }
                )
                latest["quest_claims"] = claims[-1000:]
                save_profile(latest)
                st.toast(f"Quest complete · +{quest['reward']} XP")
                st.rerun()
    st.caption("Self-care quests are self-reported. Take breaks because they feel right for you—not for a reward.")


def render_session_preferences(profile):
    prefs = profile.get("session_preferences") or {}
    default_prefs = fresh_profile()["session_preferences"]
    prefs = {**default_prefs, **prefs}

    st.markdown(
        """
        <div class="settings-shell">
          <div class="settings-header">
            <div class="settings-badge">Settings</div>
          </div>
          <h1 style="margin:0 0 0.4rem; font-size: clamp(2.4rem, 4vw, 4rem); letter-spacing: -.06em;">Session preferences</h1>
          <p style="margin:0 0 1.5rem; color:#aab8c9; font-size:1.08rem;">Shape how FocusMate watches, nudges and rewards your study time.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    left, right = st.columns([1.7, 0.9], gap="large")

    with left:
        panel = st.container(border=True)
        with panel:
            st.markdown('<div class="settings-panel"><h3>Monitoring & reminders</h3>', unsafe_allow_html=True)
            rows = [
                ("Focus monitoring", "Use the webcam locally to detect attention", "focus_monitoring"),
                ("Posture alerts", "Show a gentle reminder when the detector reports slouching", "posture_alerts"),
                ("Mood check-ins", "Ask how I feel before each first session", "mood_checkins"),
                ("Session chimes", "Soft tone at start and end of a block", "session_chimes"),
            ]
            for label, caption, key_name in rows:
                c1, c2 = st.columns([5, 1])
                with c1:
                    st.markdown(f'<div class="settings-label">{html.escape(label)}<span class="settings-caption">{html.escape(caption)}</span></div>', unsafe_allow_html=True)
                with c2:
                    enabled = st.toggle(
                        "",
                        value=bool(prefs.get(key_name, default_prefs.get(key_name, False))),
                        key=f"pref_{normalize_username(profile.get('username'))}_{key_name}",
                    )
                    prefs[key_name] = enabled
            prefs["session_length_minutes"] = st.number_input(
                "Default focus block (minutes)",
                min_value=15,
                max_value=120,
                step=5,
                value=int(prefs.get("session_length_minutes", 25) or 25),
                key=f"pref_{normalize_username(profile.get('username'))}_session_length_minutes",
            )
            prefs["daily_goal_minutes"] = st.number_input(
                "Daily study goal (minutes)",
                min_value=30,
                max_value=720,
                step=15,
                value=int(prefs.get("daily_goal_minutes", 180) or 180),
                key=f"pref_{normalize_username(profile.get('username'))}_daily_goal_minutes",
            )
            st.markdown('</div>', unsafe_allow_html=True)

        latest = load_profile()
        latest["session_preferences"] = prefs
        save_profile(latest)

    with right:
        st.markdown(
            """
            <div class="profile-card">
              <h3>Profile</h3>
            </div>
            """,
            unsafe_allow_html=True,
        )
        profile_rows = [
            ("Name", str(profile.get("player_name") or "Focus friend").strip() or "Focus friend"),
            ("Handle", f"@{str(profile.get('username') or 'focusfriend').strip() or 'focusfriend'}"),
            ("Rank", f"Level {max(0, int(profile.get('total_xp', 0) or 0)) // LEVEL_STEP + 1}"),
            ("Session length", f"{int(prefs.get('session_length_minutes', 25) or 25)} minutes"),
            (
                "Daily goal",
                f"{int(prefs.get('daily_goal_minutes', 180) or 180) // 60}h "
                f"{int(prefs.get('daily_goal_minutes', 180) or 180) % 60:02d}m",
            ),
        ]
        for key, value in profile_rows:
            st.markdown(
                f'<div class="profile-line"><div class="profile-key">{html.escape(key)}</div><div class="profile-value">{html.escape(str(value))}</div></div>',
                unsafe_allow_html=True,
            )


def render_profile(profile):
    username_key = normalize_username(profile.get("username"))
    page_header(
        "YOUR SPACE",
        "Make it yours.",
        "Your name, wellbeing notes, and saved progress stay in your local FocusMate profile.",
    )
    left, right = st.columns([1, 1], gap="large")
    with left:
        st.subheader("A little about you")
        with st.form(f"profile_form_{username_key}"):
            name = st.text_input(
                "What should we call you?",
                value=str(profile.get("player_name") or "Focus friend"),
                max_chars=40,
                key=f"profile_name_{username_key}",
            )
            username = st.text_input(
                "Username",
                value=str(profile.get("username") or "focusfriend"),
                max_chars=32,
                disabled=True,
                key=f"profile_username_{username_key}",
            )
            saved = st.form_submit_button("Save details", type="primary")
        if saved:
            if not name.strip():
                st.warning("Please enter a name, or use “Focus friend”.")
            else:
                latest = load_profile()
                latest["player_name"] = name.strip()
                save_profile(latest)
                st.success("Your profile has been updated.")
                st.rerun()

        st.subheader("Wellbeing check-in")
        st.caption("These are personal notes; the webcam does not measure sleep, water, or wellbeing.")
        wellbeing = profile["session_wellbeing"]
        with st.form(f"wellbeing_form_{username_key}"):
            sleep = st.number_input(
                "Hours of sleep last night",
                min_value=0.0,
                max_value=24.0,
                value=float(wellbeing.get("sleep_hours", 0.0) or 0.0),
                step=0.5,
                key=f"sleep_hours_{username_key}",
            )
            water = st.number_input(
                "Glasses of water today",
                min_value=0,
                max_value=100,
                value=int(wellbeing.get("water_glasses", 0) or 0),
                key=f"water_glasses_{username_key}",
            )
            reflection = st.text_area(
                "A kind note to future you",
                value=str(wellbeing.get("reflection", "")),
                max_chars=500,
                placeholder="What went well? What would make tomorrow easier?",
                key=f"reflection_{username_key}",
            )
            save_checkin = st.form_submit_button("Save check-in", type="primary")
        if save_checkin:
            latest = load_profile()
            saved_wellbeing = latest.get("session_wellbeing") or {}
            saved_wellbeing.update({
                "sleep_hours": float(sleep),
                "water_glasses": int(water),
                "reflection": reflection.strip(),
                "updated_at": datetime.now().isoformat(),
            })
            latest["session_wellbeing"] = saved_wellbeing
            save_profile(latest)
            st.success("Your check-in has been saved.")
            st.rerun()

    with right:
        st.subheader("Your data, your choice")
        st.markdown(
            "FocusMate stores your profile and completed-session history as local JSON files "
            "inside the dashboard folder. The live webcam snapshot is separate."
        )
        st.download_button(
            "Export profile as JSON",
            data=json.dumps(profile, indent=2, ensure_ascii=False),
            file_name="focusmate-profile.json",
            mime="application/json",
            width="stretch",
        )
        st.markdown(
            '<div class="surface"><h3>🔒 Local by default</h3>'
            '<p>Your profile is stored on this computer. Keep a copy of the export if you '
            'want a personal backup.</p></div>',
            unsafe_allow_html=True,
        )


def run_app():
    st.set_page_config(
        page_title="FocusMate · Your study space",
        page_icon="✳",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    inject_styles()
    if "webcam_process" not in st.session_state:
        st.session_state.webcam_process = None
    if "webcam_start_time" not in st.session_state:
        st.session_state.webcam_start_time = None

    if "welcome_step" not in st.session_state:
        st.session_state.welcome_step = "form"
    if not normalize_username(st.session_state.get("active_username")):
        st.session_state.welcome_step = "form"
    elif consume_session_reset_marker():
        st.session_state.welcome_step = "form"

    if st.session_state.welcome_step == "form":
        welcome_intro_form()
        return

    username = normalize_username(st.session_state.get("active_username"))
    if not username:
        st.session_state.welcome_step = "form"
        welcome_intro_form()
        return

    profile = load_profile(username)
    live = load_live_data()
    if "welcome_name" not in st.session_state:
        st.session_state.welcome_name = str(profile.get("player_name") or "").strip() or "Focus friend"
    if "welcome_username" not in st.session_state:
        st.session_state.welcome_username = str(profile.get("username") or "").strip() or "focusfriend"

    if st.session_state.welcome_step == "animation":
        st_autorefresh(interval=200, key="focusmate_welcome_refresh")
    elif st.session_state.get("focus_running"):
        st_autorefresh(interval=1000, key="focusmate_timer_refresh")
    elif webcam_session_active():
        st_autorefresh(interval=2000, key="focusmate_live_refresh")

    if st.session_state.welcome_step == "animation":
        welcome_animation()
        return

    inject_exit_handler()
    render_brand(profile)
    pages = {
        "Your space": [
            st.Page(
                lambda: render_overview(profile, live),
                title="Overview",
                icon=":material/home:",
                default=True,
                url_path="overview",
            ),
            st.Page(
                lambda: render_focus(profile, live),
                title="Focus room",
                icon=":material/timer:",
                url_path="focus-room",
            ),
            st.Page(
                lambda: render_insights(profile, live),
                title="Insights",
                icon=":material/monitoring:",
                url_path="insights",
            ),
        ],
        "Build good habits": [
            st.Page(
                lambda: render_quests(profile, live),
                title="Daily quests",
                icon=":material/emoji_events:",
                url_path="quests",
            ),
            st.Page(
                lambda: render_session_preferences(profile),
                title="Session preferences",
                icon=":material/settings:",
                url_path="session-preferences",
            ),
            st.Page(
                lambda: render_profile(profile),
                title="Profile & wellbeing",
                icon=":material/person:",
                url_path="profile",
            ),
        ],
    }
    page = st.navigation(pages, position="sidebar")
    page.run()
    render_pending_session_chime(profile)
    render_pending_posture_beep(profile, live)
    st.markdown(
        '<div style="margin-top:3rem;padding-top:1rem;border-top:1px solid rgba(193,217,220,.1);'
        'color:#8794a8;font-size:.78rem">FocusMate · Progress, not perfection. Be kind to yourself.</div>',
        unsafe_allow_html=True,
    )


if __name__ == "__main__":
    run_app()
