"""Animated, multi-page Streamlit experience for FocusMate (single-file edition)."""

import json
import hashlib
import html
import io
import math
import os
import re
import shutil
import secrets
import subprocess
import struct
import sys
import tempfile
import threading
import time
import wave
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
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

# These are (re)bound from the cached camera hub by ensure_stop_server().
# Streamlit re-executes this script on every rerun, so the real state lives
# inside st.cache_resource and survives reruns.
SESSION_STOP_PORT = 0
SESSION_STOP_SERVER = None
SESSION_CAMERA_TOKENS = {}
SESSION_CAMERA_FRAMES = {}
LEVEL_STEP = 100
FOCUS_CHALLENGE_SECONDS = 600
FOCUS_CHALLENGE_XP = 25
ACHIEVEMENT_DEFINITIONS = tuple(
    {"id": achievement_id, "title": title, "description": description, "xp": xp}
    for achievement_id, title, description, xp in (
        ("first_step", "First Step", "Complete your first study session.", 15),
        ("locked_in", "Locked In", "Reach a focus score of 90 or higher.", 20),
        ("time_keeper", "Time Keeper", "Complete a 15-minute session.", 15),
        ("half_hour_hero", "Half Hour Hero", "Complete a 30-minute session.", 20),
        ("hour_of_focus", "Hour of Focus", "Complete a 60-minute session.", 30),
        ("getting_started", "Getting Started", "Complete 3 sessions.", 20),
        ("focused_mind", "Focused Mind", "Complete 5 sessions.", 25),
        ("consistency", "Consistency", "Complete 10 sessions.", 35),
        ("dedicated_student", "Dedicated Student", "Complete 25 sessions.", 50),
        ("focus_master", "Focus Master", "Complete 50 sessions.", 100),
        ("two_day_streak", "2-Day Streak", "Complete sessions on 2 consecutive days.", 15),
        ("three_day_streak", "3-Day Streak", "Complete sessions on 3 consecutive days.", 20),
        ("seven_day_streak", "7-Day Streak", "Complete sessions on 7 consecutive days.", 40),
        ("fourteen_day_streak", "14-Day Streak", "Complete sessions on 14 consecutive days.", 75),
        ("thirty_day_streak", "30-Day Streak", "Complete sessions on 30 consecutive days.", 150),
        ("posture_pro", "Posture Pro", "Complete a session with no posture alerts.", 20),
        ("sit_smart", "Sit Smart", "Complete 3 sessions with no posture alerts.", 30),
        ("perfect_distance", "Perfect Distance", "Complete a session with no distance alerts.", 20),
        ("eyes_forward", "Eyes Forward", "Complete a session with no looking-away alerts.", 20),
        ("steady_session", "Steady Session", "Complete a session with no posture or distance alerts.", 35),
        ("clean_session", "Clean Session", "Complete a session with no recorded alerts.", 50),
        ("sharp_start", "Sharp Start", "Score 90 or higher in your first session.", 30),
        ("level_up", "Level Up", "Improve your focus score compared with the previous session.", 20),
        ("personal_best", "Personal Best", "Achieve your highest focus score ever.", 25),
        ("ninety_club", "90 Club", "Reach a focus score of 90 or higher.", 20),
        ("perfect_estimate", "Perfect Estimate", "Reach a focus score of 100.", 50),
        ("comeback", "Comeback", "Improve your score after a lower-scoring session.", 20),
        ("getting_better", "Getting Better", "Improve your focus score across 3 consecutive sessions.", 40),
        ("focused_week", "Focused Week", "Complete 5 sessions in one calendar week.", 35),
        ("study_routine", "Study Routine", "Complete 10 sessions across multiple days.", 50),
        ("persistence", "Persistence", "Accumulate 2 hours of study sessions.", 15),
        ("time_builder", "Time Builder", "Accumulate 5 hours of study sessions.", 25),
        ("study_veteran", "Study Veteran", "Accumulate 10 hours of study sessions.", 50),
        ("twenty_hour_club", "20-Hour Club", "Accumulate 20 hours of study sessions.", 75),
        ("fifty_hour_club", "50-Hour Club", "Accumulate 50 hours of study sessions.", 150),
        ("quick_focus", "Quick Focus", "Complete a 10-minute session with a focus score of 85 or higher.", 20),
        ("long_haul", "Long Haul", "Complete a 45-minute session.", 30),
        ("keep_going", "Keep Going", "Complete 5 sessions in a row.", 30),
        ("no_quit", "No Quit", "Complete 3 sessions in a row.", 20),
        ("early_focus", "Early Focus", "Complete a session before noon.", 15),
        ("evening_focus", "Evening Focus", "Complete a session after 6 PM.", 15),
        ("routine_builder", "Routine Builder", "Study on 7 different days.", 30),
        ("xp_collector", "XP Collector", "Earn 500 XP.", 25),
        ("xp_hunter", "XP Hunter", "Earn 1,000 XP.", 50),
        ("xp_champion", "XP Champion", "Earn 5,000 XP.", 100),
        ("explorer", "Explorer", "Complete a session with a new study goal.", 15),
        ("goal_getter", "Goal Getter", "Complete a session linked to a study goal.", 15),
        ("self_aware", "Self-Aware", "View your reflection after completing a session.", 10),
        ("ai_reflection", "AI Reflection", "View your first AI-generated session reflection.", 15),
        ("focusmate_legend", "FocusMate Legend", "Unlock 20 other achievements.", 250),
    )
)
ACHIEVEMENTS_BY_ID = {item["id"]: item for item in ACHIEVEMENT_DEFINITIONS}
LEGACY_ACHIEVEMENT_IDS = {
    "first_session": "first_step",
    "twenty_minute_focus": "time_keeper",
}

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

NUDGE_MESSAGES = {
    "looking_away": (
        (
            "Quick focus check — ready to get back to it?",
            "Looks like your attention drifted. Ready to get back to it?",
            "Your task is still waiting. Let’s continue!",
            "Small distraction detected. Back to focus?",
            "Eyes back on your study material when you’re ready.",
        ),
        (
            "Your attention has drifted a few times. Try focusing on your current task.",
            "Quick focus check — let’s get back to the task.",
        ),
        (
            "You may need a reset. Take a short break if you need one, then come back when ready.",
            "Take a moment to reset before continuing.",
        ),
    ),
    "posture": (
        (
            "Quick posture check — sit comfortably and reset your position.",
            "Small posture reminder: adjust your position if needed.",
        ),
        (
            "Your posture changed. Take a second to get comfortable.",
            "Let’s reset your posture and continue.",
        ),
        (
            "Small posture reminder: adjust your position if needed.",
            "Take a moment to get comfortable before continuing.",
        ),
    ),
    "fatigue": (
        (
            "Quick check-in: feeling ready to continue?",
            "You may benefit from a quick break.",
        ),
        (
            "Your session shows repeated eye-closure signals. Consider a short break.",
            "Take a moment to reset before continuing.",
        ),
        (
            "You may benefit from a quick break. Take a moment to reset before continuing.",
            "Your session shows repeated eye-closure signals. Consider a short break.",
        ),
    ),
}

MOTIVATIONAL_MESSAGES = (
    "One more focused minute. You’ve got this.",
    "Stay with it — you’re making progress.",
    "Back to the task. Future you will thank you.",
    "Keep going. Your goal is within reach.",
    "Let’s finish this session strong.",
)


# ---------------------------------------------------------------------------
# Users, paths and profile storage
# ---------------------------------------------------------------------------

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
        "session_reflections": [],
        "active_session_plan": {},
        "tasks": [],
        "water_glasses_today": 0,
        "water_glasses_last_reset": date.today().isoformat(),
        "focus_timer_seconds_today": 0,
        "focus_timer_date": date.today().isoformat(),
        "focus_timer_total_seconds": 0,
        "focus_timer_history": [],
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
    if not isinstance(profile.get("session_reflections"), list):
        profile["session_reflections"] = []
    profile["session_reflections"] = [
        item for item in profile["session_reflections"] if isinstance(item, dict)
    ][-100:]
    if not isinstance(profile.get("achievements"), list):
        profile["achievements"] = []
    profile["achievements"] = [
        item for item in profile["achievements"] if isinstance(item, dict)
    ]
    if not isinstance(profile.get("active_session_plan"), dict):
        profile["active_session_plan"] = {}
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
    profile["focus_timer_seconds_today"] = bounded_int(
        profile.get("focus_timer_seconds_today"), 0, 0, 86400
    )
    profile["focus_timer_total_seconds"] = bounded_int(
        profile.get("focus_timer_total_seconds"), 0, 0, 2**63 - 1
    )
    if not isinstance(profile.get("focus_timer_history"), list):
        profile["focus_timer_history"] = []
    profile["focus_timer_history"] = [
        item for item in profile["focus_timer_history"]
        if isinstance(item, dict) and isinstance(item.get("date"), str)
    ][-730:]
    water_reset_date = str(profile.get("water_glasses_last_reset") or "")
    today = date.today().isoformat()
    if water_reset_date != today:
        profile["water_glasses_today"] = 0
        profile["water_glasses_last_reset"] = today
    if str(profile.get("focus_timer_date") or "") != today:
        profile["focus_timer_seconds_today"] = 0
        profile["focus_timer_date"] = today
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
        last_permission_error = None
        for attempt in range(5):
            try:
                os.replace(temporary_path, path)
                return True
            except PermissionError as error:
                last_permission_error = error
                if attempt < 4:
                    time.sleep(0.05 * (2 ** attempt))

        with open(temporary_path, "r", encoding="utf-8") as file:
            profile_json = file.read()
        try:
            with open(path, "w", encoding="utf-8") as file:
                file.write(profile_json)
                file.flush()
                os.fsync(file.fileno())
        except OSError as error:
            raise PermissionError(
                f"Profile is locked and could not be saved at {path}"
            ) from (last_permission_error or error)
        return True
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


def current_session_streak(profile, today=None):
    today = today or date.today()
    study_days = {
        item["date"]
        for item in normalized_history(profile)
        if item["seconds"] > 0
    }
    for item in profile.get("focus_timer_history", []):
        if not isinstance(item, dict) or bounded_int(item.get("seconds"), 0, 0, 86400) == 0:
            continue
        try:
            study_days.add(date.fromisoformat(item.get("date", "")))
        except (TypeError, ValueError):
            continue
    current_day = today if today in study_days else today - timedelta(days=1)
    streak = 0
    while current_day in study_days:
        streak += 1
        current_day -= timedelta(days=1)
    return streak


def achievement_earned_ids(profile):
    earned = set()
    for item in profile.get("achievements", []):
        if isinstance(item, dict) and item.get("id"):
            achievement_id = str(item["id"])
            earned.add(LEGACY_ACHIEVEMENT_IDS.get(achievement_id, achievement_id))
    return earned


def award_achievement_ids(profile, achievement_ids):
    earned = achievement_earned_ids(profile)
    newly_earned = []
    pending = set(achievement_ids) - earned
    while pending:
        for achievement_id in sorted(pending):
            definition = ACHIEVEMENTS_BY_ID.get(achievement_id)
            if definition is None:
                continue
            record = {
                **definition,
                "earned_at": datetime.now().isoformat(),
            }
            profile["achievements"].append(record)
            newly_earned.append(record)
            earned.add(achievement_id)
            profile["total_xp"] = min(
                2**63 - 1,
                profile["total_xp"] + definition["xp"],
            )
        legend_id = "focusmate_legend"
        other_earned = earned.intersection(ACHIEVEMENTS_BY_ID) - {legend_id}
        pending = (
            {legend_id}
            if len(other_earned) >= 20 and legend_id not in earned
            else set()
        )
    return newly_earned


def award_profile_achievements(achievement_ids):
    profile = load_profile()
    newly_earned = []
    pending = set(achievement_ids)
    while True:
        earned = achievement_earned_ids(profile)
        pending.update(
            achievement_id
            for threshold, achievement_id in (
                (500, "xp_collector"),
                (1000, "xp_hunter"),
                (5000, "xp_champion"),
            )
            if profile["total_xp"] >= threshold and achievement_id not in earned
        )
        pending -= earned
        if not pending:
            break
        awards = award_achievement_ids(profile, pending)
        if not awards:
            break
        newly_earned.extend(awards)
    if newly_earned:
        save_profile(profile)
    return newly_earned


def completed_achievement_ids(profile, session_data, history_entry, plan):
    session_id = str(session_data.get("session_id") or "")
    completed_sessions = [
        item for item in profile["session_history"]
        if bounded_int(item.get("seconds"), 0, 0, 86_400) > 0
    ]
    session_count = len(completed_sessions)
    current_seconds = bounded_int(session_data.get("session_seconds"), 0, 0, 86_400)
    focus_score = safe_session_number(session_data.get("focus_score"), 0, 0, 100)
    posture_alerts = bounded_int(session_data.get("posture_alerts"), 0, 0, 100_000)
    distance_alerts = bounded_int(session_data.get("distance_alerts"), 0, 0, 100_000)
    looking_away_alerts = bounded_int(session_data.get("looking_away_alerts"), 0, 0, 100_000)
    fatigue_signals = bounded_int(session_data.get("fatigue_signals"), 0, 0, 100_000)
    session_date = str(history_entry.get("date") or "")
    try:
        end_time = datetime.fromisoformat(session_date)
    except (TypeError, ValueError):
        end_time = datetime.now()

    completed_sessions.sort(key=lambda item: str(item.get("date") or ""))
    current_index = next(
        (index for index, item in enumerate(completed_sessions) if str(item.get("session_id") or "") == session_id),
        len(completed_sessions) - 1,
    )
    session_dates = set()
    for item in completed_sessions:
        try:
            session_dates.add(datetime.fromisoformat(str(item.get("date"))).date())
        except (TypeError, ValueError):
            continue
    session_streak = 0
    streak_day = end_time.date()
    while streak_day in session_dates:
        session_streak += 1
        streak_day -= timedelta(days=1)

    scored_sessions = []
    for item in completed_sessions:
        score = item.get("focus_score")
        if score is not None:
            scored_sessions.append((str(item.get("session_id") or ""), safe_session_number(score, 0, 0, 100)))
    prior_scores = [score for item_id, score in scored_sessions if item_id != session_id]
    scored_values = [score for _, score in scored_sessions]
    current_is_first = current_index == 0
    prior_score = prior_scores[-1] if prior_scores else None
    prior_best = max(prior_scores, default=None)
    last_three = scored_values[-3:]
    session_week = end_time.isocalendar()[:2]
    week_session_count = 0
    for item in completed_sessions:
        try:
            item_week = datetime.fromisoformat(str(item.get("date"))).isocalendar()[:2]
        except (TypeError, ValueError):
            continue
        if item_week == session_week:
            week_session_count += 1

    total_study_seconds = (
        bounded_int(profile.get("total_study_seconds"), 0, 0, 2**63 - 1)
        + bounded_int(profile.get("focus_timer_total_seconds"), 0, 0, 2**63 - 1)
    )
    study_days = len({item["date"] for item in normalized_history(profile) if item["seconds"] > 0})
    study_days += len({
        item.get("date") for item in profile.get("focus_timer_history", [])
        if isinstance(item, dict) and bounded_int(item.get("seconds"), 0, 0, 86400) > 0
        and item.get("date") not in {row["date"].isoformat() for row in normalized_history(profile)}
    })
    goals_seen = {
        str(item.get("goal") or "").strip().casefold()
        for item in completed_sessions
        if str(item.get("session_id") or "") != session_id and item.get("goal")
    }
    goal = str(plan.get("goal") or "").strip()

    eligible = set()
    if session_count >= 1:
        eligible.add("first_step")
    if focus_score >= 90:
        eligible.update({"locked_in", "ninety_club"})
    if current_seconds >= 15 * 60:
        eligible.add("time_keeper")
    if current_seconds >= 30 * 60:
        eligible.add("half_hour_hero")
    if current_seconds >= 60 * 60:
        eligible.add("hour_of_focus")
    for threshold, achievement_id in (
        (3, "getting_started"), (5, "focused_mind"), (10, "consistency"),
        (25, "dedicated_student"), (50, "focus_master"),
    ):
        if session_count >= threshold:
            eligible.add(achievement_id)
    for threshold, achievement_id in (
        (2, "two_day_streak"), (3, "three_day_streak"), (7, "seven_day_streak"),
        (14, "fourteen_day_streak"), (30, "thirty_day_streak"),
    ):
        if session_streak >= threshold:
            eligible.add(achievement_id)
    if posture_alerts == 0:
        eligible.add("posture_pro")
    if sum(item.get("posture_alerts", 0) == 0 for item in completed_sessions) >= 3:
        eligible.add("sit_smart")
    if distance_alerts == 0:
        eligible.add("perfect_distance")
    if session_data.get("looking_away_detection_available") is True and looking_away_alerts == 0:
        eligible.add("eyes_forward")
    if posture_alerts == 0 and distance_alerts == 0:
        eligible.add("steady_session")
    if all(value == 0 for value in (posture_alerts, distance_alerts, looking_away_alerts, fatigue_signals)):
        eligible.add("clean_session")
    if current_is_first and focus_score >= 90:
        eligible.add("sharp_start")
    if prior_score is not None and focus_score > prior_score:
        eligible.add("level_up")
    if prior_best is None or focus_score > prior_best:
        eligible.add("personal_best")
    if focus_score == 100:
        eligible.add("perfect_estimate")
    if len(prior_scores) >= 2 and prior_scores[-1] < prior_scores[-2] < focus_score:
        eligible.add("comeback")
    if len(last_three) == 3 and last_three[0] < last_three[1] < last_three[2]:
        eligible.add("getting_better")
    if week_session_count >= 5:
        eligible.add("focused_week")
    if session_count >= 10 and len(session_dates) >= 2:
        eligible.add("study_routine")
    for threshold, achievement_id in (
        (2 * 3600, "persistence"), (5 * 3600, "time_builder"),
        (10 * 3600, "study_veteran"), (20 * 3600, "twenty_hour_club"),
        (50 * 3600, "fifty_hour_club"),
    ):
        if total_study_seconds >= threshold:
            eligible.add(achievement_id)
    if current_seconds >= 10 * 60 and focus_score >= 85:
        eligible.add("quick_focus")
    if current_seconds >= 45 * 60:
        eligible.add("long_haul")
    if len(completed_sessions) >= 5 and all(
        not item.get("abandoned", False) for item in completed_sessions[-5:]
    ):
        eligible.add("keep_going")
    if len(completed_sessions) >= 3 and all(
        not item.get("abandoned", False) for item in completed_sessions[-3:]
    ):
        eligible.add("no_quit")
    start_value = session_data.get("session_started_at")
    try:
        start_time = datetime.fromisoformat(str(start_value)) if start_value else end_time
    except (TypeError, ValueError):
        start_time = end_time
    if start_time.hour < 12:
        eligible.add("early_focus")
    if start_time.hour >= 18:
        eligible.add("evening_focus")
    if study_days >= 7:
        eligible.add("routine_builder")
    for threshold, achievement_id in (
        (500, "xp_collector"), (1000, "xp_hunter"), (5000, "xp_champion"),
    ):
        if profile["total_xp"] >= threshold:
            eligible.add(achievement_id)
    if goal and goal.casefold() not in goals_seen:
        eligible.add("explorer")
    if goal:
        eligible.add("goal_getter")
    earned_ids = achievement_earned_ids(profile)
    if len(earned_ids.intersection(ACHIEVEMENTS_BY_ID) - {"focusmate_legend"}) >= 20:
        eligible.add("focusmate_legend")
    return eligible - earned_ids


def apply_completed_session_rewards(session_data):
    if not isinstance(session_data, dict) or not session_data.get("session_completed"):
        return session_data
    session_id = str(session_data.get("session_id") or "")
    if not session_id:
        return session_data

    profile = load_profile()
    history_entry = next(
        (
            item for item in profile["session_history"]
            if str(item.get("session_id") or "") == session_id
        ),
        None,
    )
    if history_entry is None or history_entry.get("game_rewards_applied"):
        return session_data

    plan = profile.get("active_session_plan") or {}
    seconds = bounded_int(session_data.get("session_seconds"), 0, 0, 86_400)
    good_posture_seconds = bounded_int(
        session_data.get("good_posture_seconds"), 0, 0, seconds
    )
    challenge_count = seconds // FOCUS_CHALLENGE_SECONDS
    challenge_xp = challenge_count * FOCUS_CHALLENGE_XP
    history_entry.update({
        "subject": str(plan.get("subject") or "Other"),
        "goal": str(plan.get("goal") or "")[:200],
        "task_id": str(plan.get("task_id") or ""),
        "task_text": str(plan.get("task_text") or "")[:120],
        "focus_score": round(safe_session_number(session_data.get("focus_score"), 0, 0, 100), 1),
        "session_started_at": session_data.get("session_started_at"),
        "posture_alerts": bounded_int(session_data.get("posture_alerts"), 0, 0, 100_000),
        "distance_alerts": bounded_int(session_data.get("distance_alerts"), 0, 0, 100_000),
        "looking_away_alerts": bounded_int(session_data.get("looking_away_alerts"), 0, 0, 100_000),
        "looking_away_detection_available": session_data.get("looking_away_detection_available") is True,
        "fatigue_signals": bounded_int(session_data.get("fatigue_signals"), 0, 0, 100_000),
        "focus_challenge_xp": challenge_xp,
        "challenge_count": challenge_count,
        "good_posture_seconds": good_posture_seconds,
        "game_rewards_applied": True,
    })
    profile["total_xp"] = min(
        2**63 - 1,
        profile["total_xp"] + challenge_xp,
    )

    unlocked_records = []
    while True:
        eligible = completed_achievement_ids(profile, session_data, history_entry, plan)
        if not eligible:
            break
        newly_unlocked = award_achievement_ids(profile, eligible)
        if not newly_unlocked:
            break
        unlocked_records.extend(newly_unlocked)
    achievement_xp = sum(item["xp"] for item in unlocked_records)
    history_entry["achievements_unlocked"] = [item["id"] for item in unlocked_records]
    history_entry["achievement_xp"] = achievement_xp
    history_entry["xp"] = min(
        2**31 - 1,
        max(0, bounded_int(history_entry.get("xp"), 0, 0, 2**31 - 1))
        + challenge_xp
        + achievement_xp,
    )
    profile["active_session_plan"] = {}
    save_profile(profile)

    session_data.update({
        "study_subject": history_entry["subject"],
        "study_goal": history_entry["goal"],
        "linked_task_id": history_entry["task_id"],
        "linked_task": history_entry["task_text"],
        "goal_outcome": history_entry.get("goal_outcome"),
        "focus_challenge_xp": challenge_xp,
        "achievements_unlocked": unlocked_records,
    })
    session_path = user_data_file("session_data.json")
    temporary_path = session_path + ".tmp"
    with open(temporary_path, "w", encoding="utf-8") as file:
        json.dump(session_data, file, indent=2)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary_path, session_path)
    return session_data


# ---------------------------------------------------------------------------
# Focus timer helpers
# ---------------------------------------------------------------------------

def record_focus_timer_seconds(seconds):
    credited_seconds = bounded_int(seconds, 0, 0, 86400)
    if credited_seconds == 0:
        return None
    profile = load_profile()
    profile["focus_timer_seconds_today"] = min(
        86400,
        profile["focus_timer_seconds_today"] + credited_seconds,
    )
    profile["focus_timer_total_seconds"] = min(
        2**63 - 1,
        profile["focus_timer_total_seconds"] + credited_seconds,
    )
    today = date.today().isoformat()
    today_entry = next(
        (item for item in profile["focus_timer_history"] if item.get("date") == today),
        None,
    )
    if today_entry is None:
        profile["focus_timer_history"].append({"date": today, "seconds": credited_seconds})
    else:
        today_entry["seconds"] = min(
            86400,
            bounded_int(today_entry.get("seconds"), 0, 0, 86400) + credited_seconds,
        )
    save_profile(profile)
    return profile["focus_timer_seconds_today"]


def credit_active_focus_timer_segment(profile=None):
    started_at = st.session_state.get("focus_segment_started_at")
    if started_at is None:
        return
    segment_duration = max(0, int(st.session_state.get("focus_segment_duration", 0)))
    elapsed = min(segment_duration, max(0, int(time.time() - started_at)))
    if not st.session_state.get("focus_segment_camera_active", False):
        total_seconds = record_focus_timer_seconds(elapsed)
        if profile is not None and total_seconds is not None:
            profile["focus_timer_seconds_today"] = total_seconds
    st.session_state.focus_segment_started_at = None
    st.session_state.focus_segment_duration = 0
    st.session_state.focus_segment_camera_active = False


def advance_focus_timer(profile):
    if not st.session_state.get("focus_running"):
        return
    if webcam_session_active():
        st.session_state.focus_segment_camera_active = True
    remaining = max(0, int(st.session_state.focus_deadline - time.time()))
    st.session_state.focus_remaining = remaining
    if remaining > 0:
        return

    credit_active_focus_timer_segment(profile)
    st.session_state.focus_running = False
    st.session_state.focus_deadline = None
    st.session_state.focus_finished = True
    if profile.get("session_preferences", {}).get("session_chimes", False):
        st.session_state.pending_session_chime = "complete"
    st.toast("Focus block complete. Take a little break—you earned it.")


# ---------------------------------------------------------------------------
# Live session data and reflections
# ---------------------------------------------------------------------------

def load_live_data():
    username = normalize_username(st.session_state.get("active_username"))
    path = user_data_file("session_data.json", username)
    if username and not os.path.isfile(path):
        legacy = read_json(PROFILE_FILE, None)
        if isinstance(legacy, dict) and normalize_username(legacy.get("username")) == username:
            path = SESSION_FILE
    data = read_json(path, {})
    return data if isinstance(data, dict) else {}


def safe_session_number(value, default=0.0, minimum=0.0, maximum=1_000_000.0):
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    if not math.isfinite(parsed):
        return default
    return max(minimum, min(maximum, parsed))


def build_session_reflection_stats(session_data):
    duration_seconds = safe_session_number(
        session_data.get("session_seconds"),
        safe_session_number(session_data.get("session_minutes"), 0.0) * 60,
        0,
        86_400,
    )
    focus_history = []
    history = session_data.get("history", [])
    if isinstance(history, list):
        for point in history[-24:]:
            if not isinstance(point, dict):
                continue
            focus_history.append({
                "minute": round(safe_session_number(point.get("minute"), 0, 0, 1440), 1),
                "focus_score": round(safe_session_number(point.get("focus_score"), 0, 0, 100), 1),
            })

    allowed_statuses = {
        "posture": {"Good", "Slouching", "Unknown"},
        "distance": {"Good", "Too Far", "Unknown"},
    }
    posture = str(session_data.get("posture") or "Unknown")
    distance_status = str(session_data.get("distance_status") or "Unknown")
    return {
        "focus_score": round(safe_session_number(session_data.get("focus_score"), 0, 0, 100), 1),
        "duration_minutes": round(duration_seconds / 60, 1),
        "alert_counts": {
            "posture": bounded_int(session_data.get("posture_alerts"), 0, 0, 100_000),
            "screen_distance": bounded_int(session_data.get("distance_alerts"), 0, 0, 100_000),
            "looking_away": bounded_int(session_data.get("looking_away_alerts"), 0, 0, 100_000),
            "fatigue_related": bounded_int(session_data.get("fatigue_signals"), 0, 0, 100_000),
        },
        "final_signals": {
            "posture": posture if posture in allowed_statuses["posture"] else "Unknown",
            "screen_distance": distance_status if distance_status in allowed_statuses["distance"] else "Unknown",
            "looking_away": bool(session_data.get("looking_away", False)),
            "eyes_closed": bool(session_data.get("eyes_closed", False)),
            "face_detected": bool(session_data.get("face_detected", False)),
        },
        "focus_history": focus_history,
    }


def fallback_session_reflection(stats):
    score = stats["focus_score"]
    minutes = stats["duration_minutes"]
    alerts = stats["alert_counts"]
    signals = stats["final_signals"]
    if score >= 80:
        summary = f"You maintained a strong focus estimate of {score:g}/100 during this {minutes:g}-minute session."
    elif score >= 60:
        summary = f"Your focus estimate was generally steady at {score:g}/100 during this {minutes:g}-minute session, with some interruptions."
    else:
        summary = f"This {minutes:g}-minute session had several attention-related interruptions, with a focus estimate of {score:g}/100."

    went_well = [f"You completed {minutes:g} minutes of study time."]
    if signals["posture"] == "Good":
        went_well.append("Your final posture signal was good.")
    elif alerts["posture"] == 0:
        went_well.append("No posture alerts were recorded.")
    elif alerts["looking_away"] == 0:
        went_well.append("No looking-away alerts were recorded.")

    improvement_options = [
        ("posture", "Try a quick posture check when you change tasks."),
        ("screen_distance", "Adjust your seat or screen to keep a comfortable distance."),
        ("looking_away", "Before the next block, choose one small task and reduce nearby distractions."),
        ("fatigue_related", "If you notice tiredness, try a short break before your next focus block."),
    ]
    highest_count = max((alerts[key] for key, _ in improvement_options), default=0)
    if highest_count:
        try_next = [next(text for key, text in improvement_options if alerts[key] == highest_count)]
    else:
        try_next = ["Keep the setup that worked for you and take a short break before your next block."]
    return {
        "summary": summary,
        "what_went_well": went_well[:2],
        "try_next": try_next,
    }


def request_ai_session_reflection(stats):
    api_key = os.environ.get("FOCUSMATE_AI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    endpoint = os.environ.get(
        "FOCUSMATE_AI_ENDPOINT",
        "https://api.openai.com/v1/chat/completions",
    )
    model = os.environ.get("FOCUSMATE_AI_MODEL", "gpt-4o-mini")
    request_body = {
        "model": model,
        "temperature": 0.7,
        "max_tokens": 280,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Write a brief, supportive study-session reflection using only the supplied statistics. "
                    "Do not invent events, diagnose, shame, insult, or judge the student. Treat fatigue values "
                    "only as fatigue-related signals. Return JSON with summary (one or two sentences), "
                    "what_went_well (one or two short strings), and try_next (one practical short string)."
                ),
            },
            {"role": "user", "content": json.dumps(stats, separators=(",", ":"))},
        ],
    }
    request = Request(
        endpoint,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            response_data = json.loads(response.read(64_000).decode("utf-8"))
        content = response_data["choices"][0]["message"]["content"]
        reflection = json.loads(content)
        summary = reflection.get("summary")
        went_well = reflection.get("what_went_well")
        try_next = reflection.get("try_next")
        if isinstance(try_next, str):
            try_next = [try_next]
        if isinstance(went_well, str):
            went_well = [went_well]
        if not isinstance(summary, str) or not isinstance(went_well, list) or not isinstance(try_next, list):
            return None
        clean_went_well = [item.strip()[:180] for item in went_well if isinstance(item, str) and item.strip()][:2]
        clean_try_next = [item.strip()[:180] for item in try_next if isinstance(item, str) and item.strip()][:2]
        if not clean_went_well or not clean_try_next:
            return None
        return {
            "summary": summary.strip()[:500],
            "what_went_well": clean_went_well,
            "try_next": clean_try_next,
        }
    except Exception:
        return None


def create_session_reflection_if_needed(session_data=None):
    session_data = session_data if isinstance(session_data, dict) else load_live_data()
    session_id = str(session_data.get("session_id") or "")
    if not session_id or not session_data.get("session_completed"):
        return None

    profile = load_profile()
    reflections = profile["session_reflections"]
    existing = next(
        (item for item in reversed(reflections) if item.get("session_id") == session_id),
        None,
    )
    if existing:
        if existing.get("source") == "AI-generated":
            award_profile_achievements({"ai_reflection"})
        return existing

    stats = build_session_reflection_stats(session_data)
    reflection = request_ai_session_reflection(stats)
    source = "AI-generated" if reflection else "Fallback"
    if reflection is None:
        reflection = fallback_session_reflection(stats)
    saved_reflection = {
        "session_id": session_id,
        "generated_at": datetime.now().isoformat(),
        "source": source,
        **reflection,
        "stats": stats,
    }
    reflections.append(saved_reflection)
    profile["session_reflections"] = reflections[-100:]
    save_profile(profile)
    if source == "AI-generated":
        award_profile_achievements({"ai_reflection"})
    return saved_reflection


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

    if isinstance(live, dict) and live.get("session_completed"):
        live = apply_completed_session_rewards(live)
        create_session_reflection_if_needed(live)

    try:
        os.remove(marker_path)
    except OSError:
        pass
    return True


# ---------------------------------------------------------------------------
# Webcam session management
# ---------------------------------------------------------------------------

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


def _browser_camera_document(frame_url):
        return f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{ margin: 0; background: #101820; color: #e6f1ef; font: 14px sans-serif; }}
        .camera {{ overflow: hidden; border-radius: 8px; background: #0a1015; }}
        video {{ display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }}
        .controls {{ display: flex; align-items: center; gap: 12px; padding: 10px 12px; }}
        button {{ border: 0; border-radius: 6px; padding: 8px 12px; background: #a8f0d0; color: #10201b; font-weight: 700; cursor: pointer; }}
        #status {{ color: #c4d4d2; }}
    </style>
</head>
<body>
    <div class="camera">
        <video id="camera" autoplay playsinline muted></video>
        <div class="controls">
            <button id="allow-camera" type="button">Allow camera</button>
            <span id="status">Your browser will ask for camera permission.</span>
        </div>
    </div>
    <script>
        const frameUrl = {json.dumps(frame_url)};
        const camera = document.getElementById("camera");
        const status = document.getElementById("status");
        const allowButton = document.getElementById("allow-camera");
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        let cameraStream = null;
        let uploadTimer = null;
        let uploading = false;

        function stopCamera() {{
            if (uploadTimer !== null) window.clearInterval(uploadTimer);
            uploadTimer = null;
            if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }}

        async function uploadFrame() {{
            if (!cameraStream || uploading || !camera.videoWidth) return;
            uploading = true;
            const scale = Math.min(1, 640 / camera.videoWidth);
            canvas.width = Math.round(camera.videoWidth * scale);
            canvas.height = Math.round(camera.videoHeight * scale);
            context.drawImage(camera, 0, 0, canvas.width, canvas.height);
            try {{
                const image = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.65));
                if (!image) throw new Error("Could not encode camera frame");
                const response = await fetch(frameUrl, {{
                    method: "POST",
                    headers: {{ "Content-Type": "image/jpeg" }},
                    body: image
                }});
                if (response.status === 403) {{
                    stopCamera();
                    status.textContent = "This camera session has ended.";
                    return;
                }}
                if (!response.ok) throw new Error("Frame upload failed");
            }} catch (error) {{
                status.textContent = "Camera is on, but analysis is not connected.";
            }} finally {{
                uploading = false;
            }}
        }}

        allowButton.addEventListener("click", async () => {{
            allowButton.disabled = true;
            status.textContent = "Waiting for camera permission...";
            try {{
                cameraStream = await navigator.mediaDevices.getUserMedia({{
                    video: {{ width: {{ ideal: 640 }}, height: {{ ideal: 360 }}, frameRate: {{ ideal: 30 }} }},
                    audio: false
                }});
                camera.srcObject = cameraStream;
                await camera.play();
                status.textContent = "Camera connected · live preview";
                allowButton.textContent = "Camera enabled";
                uploadTimer = window.setInterval(uploadFrame, 125);
            }} catch (error) {{
                allowButton.disabled = false;
                status.textContent = error.name === "NotAllowedError"
                    ? "Camera permission was denied. Allow it in your browser's site settings and try again."
                    : "Could not start the camera: " + error.message;
            }}
        }});

        window.addEventListener("pagehide", stopCamera);
    </script>
</body>
</html>"""


@st.cache_resource(show_spinner=False)
def _camera_hub():
    """One HTTP server + shared token/frame stores for the whole Streamlit process."""
    tokens, frames = {}, {}

    class StopHandler(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _authorized(self, key, query):
            supplied = query.get("token", [""])[0]
            expected = tokens.get(key, "")
            return bool(
                re.fullmatch(r"[a-f0-9]{32}", key)
                and expected
                and secrets.compare_digest(supplied, expected)
            )

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            parsed = urlsplit(self.path)
            camera_prefix = "/focusmate-camera/"
            if parsed.path.startswith(camera_prefix):
                key = parsed.path.removeprefix(camera_prefix)
                query = parse_qs(parsed.query)
                if not self._authorized(key, query):
                    self.send_response(403)
                    self._cors()
                    self.end_headers()
                    return
                token = query.get("token", [""])[0]
                frame_url = (
                    f"http://127.0.0.1:{self.server.server_address[1]}"
                    f"/focusmate-frame/{key}?token={token}"
                )
                document = _browser_camera_document(frame_url).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(document)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(document)
                return

            prefix = "/focusmate-frame/"
            key = parsed.path.removeprefix(prefix)
            if not parsed.path.startswith(prefix) or not self._authorized(key, parse_qs(parsed.query)):
                self.send_response(403)
                self._cors()
                self.end_headers()
                return
            latest = frames.get(key)
            version = str(latest[0]) if latest else ""
            if not latest or self.headers.get("If-None-Match", "").strip('"') == version:
                self.send_response(204)
                self._cors()
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(latest[1])))
            self.send_header("ETag", f'"{version}"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(latest[1])

        def do_POST(self):
            parsed = urlsplit(self.path)
            path = parsed.path
            if path.startswith("/focusmate-frame/"):
                key = path.removeprefix("/focusmate-frame/")
                if not self._authorized(key, parse_qs(parsed.query)):
                    self.send_response(403)
                    self._cors()
                    self.end_headers()
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    length = 0
                if (
                    length < 4
                    or length > 1_500_000
                    or not self.headers.get("Content-Type", "").startswith("image/jpeg")
                ):
                    self.send_response(413)
                    self._cors()
                    self.end_headers()
                    return
                data = self.rfile.read(length)
                if not data.startswith(b"\xff\xd8"):
                    self.send_response(400)
                    self._cors()
                    self.end_headers()
                    return
                frames[key] = (time.monotonic_ns(), data)
                self.send_response(204)
                self._cors()
                self.end_headers()
                return

            key = path.removeprefix("/focusmate-stop/")
            if path.startswith("/focusmate-stop/") and re.fullmatch(r"[a-f0-9]{32}", key):
                tokens.pop(key, None)
                frames.pop(key, None)
                directory = os.path.join(PROFILE_DIR, key)
                try:
                    os.makedirs(directory, exist_ok=True)
                    with open(os.path.join(directory, "stop_session.request"), "w", encoding="utf-8") as file:
                        file.write("stop")
                    mark_session_closed(os.path.join(directory, "session_closed.marker"))
                except Exception:
                    pass
                self.send_response(200)
                self._cors()
                self.end_headers()
                self.wfile.write(b"ok")
                return
            self.send_response(404)
            self._cors()
            self.end_headers()

        def log_message(self, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), StopHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return {"server": server, "port": server.server_address[1], "tokens": tokens, "frames": frames}


def ensure_stop_server():
    global SESSION_STOP_PORT, SESSION_STOP_SERVER, SESSION_CAMERA_TOKENS, SESSION_CAMERA_FRAMES
    hub = _camera_hub()
    SESSION_STOP_PORT = hub["port"]
    SESSION_STOP_SERVER = hub["server"]
    SESSION_CAMERA_TOKENS = hub["tokens"]
    SESSION_CAMERA_FRAMES = hub["frames"]
    return hub["server"]


def start_webcam(session_plan=None):
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
    camera_key = None
    try:
        ensure_stop_server()
        camera_key = os.path.basename(user_data_directory())
        camera_token = secrets.token_urlsafe(24)
        SESSION_CAMERA_TOKENS[camera_key] = camera_token
        st.session_state.pop("focusmate_latest_reflection_id", None)
        worker_env = os.environ.copy()
        worker_env["FOCUSMATE_SESSION_FILE"] = user_data_file("session_data.json")
        worker_env["FOCUSMATE_PROFILE_FILE"] = profile_file()
        worker_env["FOCUSMATE_FRAME_FILE"] = user_data_file("latest_frame.jpg")
        worker_env["FOCUSMATE_STOP_FILE"] = stop_path
        worker_env["FOCUSMATE_CAMERA_FRAME_URL"] = (
            f"http://127.0.0.1:{SESSION_STOP_PORT}/focusmate-frame/{camera_key}"
        )
        worker_env["FOCUSMATE_CAMERA_TOKEN"] = camera_token
        st.session_state["webcam_previous_session_id"] = load_live_data().get("session_id")
        st.session_state.webcam_process = subprocess.Popen(
            [WEBCAM_PYTHON, WEBCAM_FILE], cwd=WEBCAM_DIR, env=worker_env
        )
        st.session_state.webcam_start_time = datetime.now()
        st.session_state.browser_camera_token = camera_token
        latest_profile = load_profile()
        latest_profile["active_session_plan"] = session_plan if isinstance(session_plan, dict) else {}
        save_profile(latest_profile)
        st.session_state["active_session_plan"] = latest_profile["active_session_plan"]
    except OSError as error:
        if camera_key:
            SESSION_CAMERA_TOKENS.pop(camera_key, None)
        return False, f"Could not start the webcam detector: {error}"
    return True, "Your webcam study session has started."


def stop_webcam():
    ensure_stop_server()
    process = st.session_state.get("webcam_process")
    process_running = process is not None and process.poll() is None
    session_active = webcam_session_active()
    if not process_running and not session_active:
        return False, "There is no running webcam session to stop."

    try:
        os.makedirs(user_data_directory(), exist_ok=True)
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

    final_session_data = load_live_data()
    if not process_running:
        wait_deadline = time.monotonic() + 5
        while final_session_data.get("session_active") and time.monotonic() < wait_deadline:
            time.sleep(0.1)
            final_session_data = load_live_data()
    previous_session_id = st.session_state.pop("webcam_previous_session_id", None)
    reflection = None
    if final_session_data.get("session_id") != previous_session_id:
        final_session_data = apply_completed_session_rewards(final_session_data)
        reflection = create_session_reflection_if_needed(final_session_data)
    if reflection:
        st.session_state["focusmate_latest_reflection_id"] = reflection["session_id"]

    st.session_state.webcam_process = None
    st.session_state.webcam_start_time = None
    frame_path = user_data_file("latest_frame.jpg")
    if os.path.exists(frame_path):
        try:
            os.remove(frame_path)
        except OSError:
            pass
    camera_key = os.path.basename(user_data_directory())
    SESSION_CAMERA_TOKENS.pop(camera_key, None)
    SESSION_CAMERA_FRAMES.pop(camera_key, None)
    st.session_state.pop("browser_camera_token", None)
    stop_path = user_data_file("stop_session.request")
    if process is not None and os.path.exists(stop_path):
        try:
            os.remove(stop_path)
        except OSError:
            pass
    return True, "Session ended. Your progress has been saved."


def inject_exit_handler():
    ensure_stop_server()
    key = hashlib.sha256(
        normalize_username(st.session_state.get("active_username")).encode("utf-8")
    ).hexdigest()[:32]
    stop_url = f"http://127.0.0.1:{SESSION_STOP_PORT}/focusmate-stop/{key}"
    components.html(
        f"""
        <script>
          const w = window.parent;
          w.__focusmateStopUrl = {json.dumps(stop_url)};
          if (!w.__focusmateStopBound) {{
            w.__focusmateStopBound = true;
            w.addEventListener('pagehide', () => {{
              try {{ navigator.sendBeacon(w.__focusmateStopUrl, 'stop'); }} catch (e) {{}}
            }});
          }}
        </script>
        """,
        height=0,
    )


# ---------------------------------------------------------------------------
# Styling
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Welcome flow and shared UI pieces
# ---------------------------------------------------------------------------

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


CAMERA_OFF_HTML = (
    '<div style="height:240px;display:flex;align-items:center;justify-content:center;'
    'border:1px solid rgba(193,217,220,.12);border-radius:18px;background:rgba(17,25,34,.65);'
    'color:#aab7c7;font-weight:600;">Camera off</div>'
)


def render_live_camera_preview():
    frame_path = user_data_file("latest_frame.jpg")
    if not os.path.exists(frame_path):
        st.markdown(CAMERA_OFF_HTML, unsafe_allow_html=True)
        return
    try:
        from PIL import Image
        image = Image.open(frame_path)
        st.image(image, use_container_width=True)
    except Exception:
        try:
            st.image(frame_path, use_container_width=True)
        except Exception:
            st.markdown(CAMERA_OFF_HTML, unsafe_allow_html=True)


def render_browser_camera_preview(token, height=330):
    ensure_stop_server()
    camera_key = os.path.basename(user_data_directory())
    camera_url = (
        f"http://127.0.0.1:{SESSION_STOP_PORT}/focusmate-camera/"
        f"{camera_key}?token={token}"
    )
    st.iframe(camera_url, height=height)


def render_shared_camera_panel(live):
    camera_token = st.session_state.get("browser_camera_token")
    if not camera_token:
        return

    st.markdown("### Live study session")
    st.caption("Camera preview and current signals stay here while you move between pages.")
    preview_column, signals_column = st.columns([1.05, 1.4], gap="large", vertical_alignment="top")
    with preview_column:
        render_browser_camera_preview(camera_token, height=330)
    with signals_column:
        if live_snapshot_is_fresh(live, max_age=20):
            focus_score = bounded_int(live.get("focus_score"), 0, 0, 100)
            focus_label = "Good" if focus_score >= 80 else "Average" if focus_score >= 60 else "Several interruptions"
            posture = str(live.get("posture") or "Unknown").strip()
            distance_status = str(live.get("distance_status") or "Unknown").strip()
            face_detected = bool(live.get("face_detected"))
            eyes = "Not detected" if not face_detected else "Closed" if live.get("eyes_closed") else "Open"
            face = "Detected" if face_detected else "Not detected"
            first_row = st.columns(3, gap="small")
            for column, (label, value) in zip(
                first_row,
                (
                    ("Focus estimate", focus_label),
                    ("Posture now", posture if posture != "Unknown" else "Not detected"),
                    ("Screen distance now", "Too far" if distance_status == "Too Far" else distance_status),
                ),
            ):
                with column:
                    st.metric(label, value)
            second_row = st.columns(2, gap="small")
            for column, (label, value) in zip(
                second_row,
                (("Eyes now", eyes), ("Face now", face)),
            ):
                with column:
                    st.metric(label, value)

            session_seconds = bounded_int(live.get("session_seconds"), 0, 0, 86_400)
            challenge_minutes = session_seconds % FOCUS_CHALLENGE_SECONDS // 60
            completed_challenges = session_seconds // FOCUS_CHALLENGE_SECONDS
            st.markdown("**🎯 Focus challenge**")
            st.progress(
                (session_seconds % FOCUS_CHALLENGE_SECONDS) / FOCUS_CHALLENGE_SECONDS,
                text=f"{challenge_minutes} / 10 minutes · {completed_challenges} completed",
            )
            st.caption(f"+{FOCUS_CHALLENGE_XP} XP per completed challenge")
        else:
            st.warning("Waiting for fresh camera statistics. Keep this page open while the camera connects.")
    st.divider()


def mood_prompt_required(profile):
    prefs = profile.get("session_preferences") or {}
    if not prefs.get("mood_checkins", True):
        return False
    wellbeing = profile.get("session_wellbeing") or {}
    return wellbeing.get("mood_checkin_date") != date.today().isoformat()


def mood_motivation(selected_mood):
    messages = {
        "Calm": "Steady pace, clear mind — you’re ready to move with intention.",
        "Focused": "Nice focus — keep that momentum going and trust your flow.",
        "Okay": "A solid 'okay' day still counts. One small step is enough to build momentum.",
        "Tired": "You do not need to force it all. Take it gently and keep the session light.",
        "Stressed": "Pause, breathe, and take it one task at a time. You’ve got this.",
    }
    return messages.get(selected_mood, "Small progress still counts — today is a good day to start where you are.")


def progressive_nudge(signal, occurrence_count, rotation=0):
    messages = NUDGE_MESSAGES.get(signal)
    if not messages:
        return None
    occurrence_count = max(1, int(occurrence_count))
    tier = 1 if occurrence_count == 1 else 2 if occurrence_count <= 3 else 3
    tier_start = 1 if tier == 1 else 2 if tier == 2 else 4
    variants = messages[tier - 1]
    message_index = (occurrence_count - tier_start + max(0, int(rotation))) % len(variants)
    return tier, variants[message_index]


def render_webcam_controls(live, profile):
    running = webcam_is_running()
    active = webcam_session_active()
    fresh = live_snapshot_is_fresh(live, max_age=20)
    prefs = {**fresh_profile()["session_preferences"], **profile.get("session_preferences", {})}
    mood_prompt = mood_prompt_required(profile)
    selected_mood = "Choose a mood"
    if not running and not active:
        if not prefs.get("focus_monitoring", True):
            st.info("Webcam monitoring is off. Turn it on in Session preferences to start a camera session.")
            render_live_camera_preview()
            return

        st.info("Ready when you are. The camera only starts when you choose.")
        username = normalize_username(profile.get("username"))
        subject_options = ["Mathematics", "Science", "Coding", "Assignment", "Other"]
        subject = st.selectbox(
            "What are you working on?",
            subject_options,
            key=f"session_subject_{username}",
        )
        if subject == "Other":
            subject = st.text_input(
                "Study subject",
                max_chars=40,
                placeholder="What are you studying?",
                key=f"session_subject_other_{username}",
            ).strip() or "Other"
        session_goal = st.text_input(
            "Session goal",
            max_chars=200,
            placeholder="e.g. Complete Chapter 4 exercises",
            key=f"session_goal_{username}",
        ).strip()
        task_by_id = {
            str(task.get("id")): task
            for task in profile.get("tasks", [])
            if not task.get("done") and task.get("id")
        }
        task_id = st.selectbox(
            "Link a task (optional)",
            [""] + list(task_by_id),
            format_func=lambda value: "No linked task" if not value else str(task_by_id[value].get("text", "Task")),
            key=f"session_task_{username}",
        )
        if mood_prompt:
            selected_mood = st.selectbox(
                "How are you feeling before this session?",
                ["Choose a mood", "Calm", "Focused", "Okay", "Tired", "Stressed"],
                key=f"mood_checkin_{username}_{date.today().isoformat()}",
            )
            if selected_mood != "Choose a mood":
                st.caption(f"💬 {mood_motivation(selected_mood)}")
        if st.button(
            "📷 Start camera",
            type="primary",
            width="stretch",
            disabled=not session_goal or (mood_prompt and selected_mood == "Choose a mood"),
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
            task = task_by_id.get(task_id, {})
            session_plan = {
                "subject": subject,
                "goal": session_goal,
                "task_id": task_id,
                "task_text": str(task.get("text") or ""),
            }
            ok, message = start_webcam(session_plan)
            (st.success if ok else st.error)(message)
            st.rerun()
        st.caption("No active camera session. Your focus timer works independently.")
        render_live_camera_preview()
        return

    st.success("Your webcam session is running.")
    if st.button("🛑 Stop camera", type="primary", width="stretch"):
        ok, message = stop_webcam()
        (st.success if ok else st.warning)(message)
        if ok and st.session_state.get("focusmate_latest_reflection_id"):
            st.session_state["focusmate_open_session_results"] = True
        st.rerun()

    st.caption("The live camera preview stays in the sidebar while you move between pages.")

    focus_estimate = bounded_int(live.get("focus_score"), 0, 0, 100)
    posture = str(live.get("posture") or "Unknown").strip()
    distance_status = str(live.get("distance_status") or "Unknown").strip()
    face_detected = bool(live.get("face_detected"))
    eyes_closed = bool(live.get("eyes_closed"))
    focus_label = "Good" if focus_estimate >= 80 else "Average" if focus_estimate >= 60 else "Several interruptions"
    posture_label = {
        "Good": "Good",
        "Slouching": "Slouching",
    }.get(posture, "Not detected")
    distance_label = {
        "Good": "Good",
        "Too Far": "Too far",
    }.get(distance_status, "Not measured")
    eyes_label = "Not detected" if not face_detected else "Closed" if eyes_closed else "Open"
    face_label = "Detected" if face_detected else "Not detected"
    signals = [
        ("Focus estimate", focus_label),
        ("Posture now", posture_label),
        ("Screen distance now", distance_label),
        ("Eyes now", eyes_label),
        ("Face now", face_label),
    ]
    with st.container():
        first_row = st.columns(3)
        for column, (label, value) in zip(first_row, signals[:3]):
            with column:
                st.metric(label, value)
        second_row = st.columns(2)
        for column, (label, value) in zip(second_row, signals[3:]):
            with column:
                st.metric(label, value)
    st.caption(
        "Focus estimate uses detected eye-closure, face-missing, posture, and distance time "
        "relative to this session. Looking-away detection is not currently available. "
        "Posture, distance, eyes, and face describe the latest detected state."
    )

    if active and fresh:
        st.success("Live connection · your study buddy is checking in.")
        active_nudges = []
        looking_away_count = bounded_int(live.get("looking_away_alerts"), 0, 0, 100_000)
        posture_alert_count = bounded_int(live.get("posture_alerts"), 0, 0, 100_000)
        fatigue_signal_count = bounded_int(live.get("fatigue_signals"), 0, 0, 100_000)
        if bool(live.get("looking_away")):
            active_nudges.append(("looking_away", looking_away_count + 1))
        if prefs.get("posture_alerts", True) and posture == "Slouching":
            active_nudges.append(("posture", posture_alert_count + 1))
        if eyes_closed:
            active_nudges.append(("fatigue", fatigue_signal_count + 1))

        if active_nudges:
            signal, occurrence_count = max(active_nudges, key=lambda item: item[1])
            rotation = bounded_int(profile.get("sessions_completed"), 0, 0, 2**31 - 1)
            nudge = progressive_nudge(signal, occurrence_count, rotation)
            if nudge:
                st.info(nudge[1])
        else:
            completed_sessions = bounded_int(profile.get("sessions_completed"), 0, 0, 2**31 - 1)
            st.caption(MOTIVATIONAL_MESSAGES[completed_sessions % len(MOTIVATIONAL_MESSAGES)])
    elif active:
        st.warning("The latest camera update is delayed. Check that the detector is still running.")
    else:
        st.caption("No active camera session. Your focus timer works independently.")


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

def render_overview(profile, live):
    xp = max(0, int(profile.get("total_xp", 0) or 0))
    level = xp // LEVEL_STEP + 1
    xp_into_level = xp % LEVEL_STEP
    xp_to_next = LEVEL_STEP - xp_into_level
    total_study_seconds = max(0, int(profile.get("total_study_seconds", 0) or 0))
    total_study_seconds += max(0, int(profile.get("focus_timer_total_seconds", 0) or 0))
    minutes = total_study_seconds // 60
    history = profile["session_history"]
    water_today = int(profile.get("water_glasses_today", 0) or 0)
    player_name = str(profile.get("player_name") or "Focus friend").strip()
    hour = datetime.now().hour
    greeting = "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"
    st.markdown(f'<div class="eyebrow">{greeting.upper()}</div>', unsafe_allow_html=True)
    hero(player_name, xp_to_next)
    if st.button("🎯 Start a focus session", type="primary", key="overview_start_focus"):
        st.session_state["focusmate_open_focus_room"] = True
        st.rerun()

    a, b, c, d, e = st.columns(5, gap="small")
    with a:
        stat_card("Your level", f"Level {level}", f"{xp_into_level} / {LEVEL_STEP} XP")
    with b:
        stat_card("Lifetime XP", f"{xp:,}", "From study, posture & quests")
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
    today_seconds += int(profile.get("focus_timer_seconds_today", 0) or 0)
    if st.session_state.get("focus_running") and not st.session_state.get(
        "focus_segment_camera_active", False
    ):
        segment_started_at = st.session_state.get("focus_segment_started_at")
        segment_duration = max(0, int(st.session_state.get("focus_segment_duration", 0)))
        if segment_started_at is not None:
            today_seconds += min(
                segment_duration,
                max(0, int(time.time() - segment_started_at)),
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
    st.metric("Study streak", f"{current_session_streak(profile)} days")
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


def _build_chime_wav(notes, note_duration, amplitude, release):
    sample_rate = 22050
    frames = bytearray()
    for index in range(int(sample_rate * note_duration * len(notes))):
        elapsed = index / sample_rate
        note_index = min(int(elapsed / note_duration), len(notes) - 1)
        note_time = elapsed - note_index * note_duration
        envelope = min(1.0, note_time / 0.01, (note_duration - note_time) / release)
        sample = int(amplitude * max(0.0, envelope) * math.sin(2 * math.pi * notes[note_index] * note_time))
        frames.extend(struct.pack("<h", sample))

    audio = io.BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(bytes(frames))
    return audio.getvalue()


def render_pending_session_chime(profile):
    kind = st.session_state.pop("pending_session_chime", None)
    if kind not in {"start", "complete"}:
        return
    if not profile.get("session_preferences", {}).get("session_chimes", False):
        return
    notes = (587.33, 783.99) if kind == "start" else (783.99, 587.33)
    wav = _build_chime_wav(notes, 0.18, 5000, 0.035)
    st.audio(wav, format="audio/wav", autoplay=True, width="content")


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
    wav = _build_chime_wav((220.0, 180.0), 0.22, 7000, 0.04)
    st.audio(wav, format="audio/wav", autoplay=True, width="content")


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
        st.session_state.focus_segment_started_at = None
        st.session_state.focus_segment_duration = 0
        st.session_state.focus_segment_camera_active = False
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
            st.session_state.focus_segment_started_at = time.time()
            st.session_state.focus_segment_duration = remaining
            st.session_state.focus_segment_camera_active = webcam_session_active()
            if preferences.get("session_chimes", False):
                st.session_state.pending_session_chime = "start"
            st.rerun()
    with pause_col:
        if st.button("Pause", width="stretch", disabled=not st.session_state.focus_running):
            st.session_state.focus_remaining = max(
                0, int(st.session_state.focus_deadline - time.time())
            )
            credit_active_focus_timer_segment(profile)
            st.session_state.focus_running = False
            st.session_state.focus_deadline = None
            st.rerun()
    with reset_col:
        if st.button("Reset", width="stretch"):
            if st.session_state.focus_running:
                credit_active_focus_timer_segment(profile)
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
            earned_task_xp = 0
            for saved_task in latest["tasks"]:
                if str(saved_task.get("id")) == task_id:
                    saved_task["done"] = checked
                    if checked and not saved_task.get("xp_awarded"):
                        earned_task_xp = 10
                        saved_task["xp_awarded"] = True
                        saved_task["completed_at"] = datetime.now().isoformat()
                    break
            if earned_task_xp:
                latest["total_xp"] = min(
                    2**63 - 1,
                    max(0, int(latest.get("total_xp", 0) or 0)) + earned_task_xp,
                )
            save_profile(latest)
            unlocked = award_profile_achievements(set()) if earned_task_xp else []
            if earned_task_xp:
                st.toast(f"Task complete · +{earned_task_xp} XP")
            if unlocked:
                st.toast(f"Achievement unlocked · {unlocked[0]['title']}")
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
            posture_xp = max(0, int(entry.get("posture_xp", 0)))
            good_posture_seconds = max(0, int(entry.get("good_posture_seconds", 0)))
        except (TypeError, ValueError):
            continue
        raw_focus = entry.get("focus_score")
        focus_score = (
            round(safe_session_number(raw_focus, 0, 0, 100), 1)
            if raw_focus is not None
            else None
        )
        rows.append({
            "date": when,
            "seconds": seconds,
            "xp": xp,
            "posture_xp": posture_xp,
            "good_posture_seconds": good_posture_seconds,
            "focus_score": focus_score,
            "subject": str(entry.get("subject") or ""),
            "goal": str(entry.get("goal") or ""),
            "task_text": str(entry.get("task_text") or ""),
            "goal_outcome": str(entry.get("goal_outcome") or ""),
            "focus_challenge_xp": max(0, int(entry.get("focus_challenge_xp", 0) or 0)),
        })
    return rows


def render_insights(profile, live):
    page_header(
        "MY PROGRESS",
        "See how you’re building your rhythm.",
        "Your focus estimates, study time, and streaks across completed sessions.",
    )
    rows = normalized_history(profile)
    total_sessions = int(profile.get("sessions_completed", 0) or 0)
    focus_rows = [item for item in rows if item["focus_score"] is not None]
    average_focus = (
        sum(item["focus_score"] for item in focus_rows) / len(focus_rows)
        if focus_rows else None
    )
    total_seconds = int(profile.get("total_study_seconds", 0) or 0)
    total_seconds += int(profile.get("focus_timer_total_seconds", 0) or 0)
    streak = current_session_streak(profile)
    a, b, c, d = st.columns(4)
    a.metric("Average focus estimate", f"{average_focus:.0f} / 100" if average_focus is not None else "Not yet available")
    b.metric("Sessions", total_sessions)
    c.metric("Total study time", f"{total_seconds // 3600}h {(total_seconds % 3600) // 60:02d}m")
    d.metric("Study-day streak", f"{streak} days")

    st.write("")
    chart_col, week_col = st.columns([1.15, .85], gap="large")
    with chart_col:
        st.subheader("Focus trend · recent sessions")
        if focus_rows:
            trend = pd.DataFrame(
                {"Focus estimate": [item["focus_score"] for item in focus_rows[-20:]]},
                index=[item["date"].strftime("%b %d") for item in focus_rows[-20:]],
            )
            st.line_chart(trend, color="#d6f58a", width="stretch")
            if len(focus_rows) >= 4:
                earlier = [item["focus_score"] for item in focus_rows[:-3]]
                recent = [item["focus_score"] for item in focus_rows[-3:]]
                difference = sum(recent) / len(recent) - sum(earlier) / len(earlier)
                if difference >= 5:
                    st.success(f"Your last three scored sessions averaged {difference:.0f} points higher than earlier recorded sessions.")
                elif difference <= -5:
                    st.info(f"Your recent focus estimates were {abs(difference):.0f} points lower on average. A smaller, clearer goal may help next time.")
                else:
                    st.caption("Your recent focus estimates are broadly in line with earlier sessions.")
        else:
            st.info("Focus trends will appear after your next completed webcam session. Older sessions without saved focus scores remain unchanged.")
        st.caption("Focus estimates are heuristic study signals, not a direct measurement of attention.")

    with week_col:
        st.subheader("Study time · last 7 days")
        start = date.today() - timedelta(days=6)
        daily = {start + timedelta(days=offset): 0 for offset in range(7)}
        for item in rows:
            if item["date"] in daily:
                daily[item["date"]] += item["seconds"]
        for item in profile.get("focus_timer_history", []):
            try:
                timer_day = date.fromisoformat(item["date"])
                if timer_day in daily:
                    daily[timer_day] += bounded_int(item.get("seconds"), 0, 0, 86400)
            except (TypeError, ValueError):
                continue
        daily_minutes = {day: seconds // 60 for day, seconds in daily.items()}
        chart_data = pd.DataFrame(
            {"Study minutes": list(daily_minutes.values())},
            index=[day.strftime("%a") for day in daily_minutes],
        )
        st.bar_chart(chart_data, color="#a8f0d0", width="stretch")
        st.caption(f"{sum(daily_minutes.values())} minutes this week · webcam sessions and timer-only study")

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
                "Subject": item["subject"],
                "Goal": item["goal"],
                "Task": item["task_text"],
                "Goal outcome": item["goal_outcome"],
                "Study time": f"{item['seconds'] // 60} min",
                "Focus estimate": item["focus_score"] if item["focus_score"] is not None else "—",
                "Good posture": f"{item['good_posture_seconds'] // 60} min",
                "Challenge XP": item["focus_challenge_xp"],
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


def replace_with_retry(temporary_path, target_path):
    last_permission_error = None
    for attempt in range(5):
        try:
            os.replace(temporary_path, target_path)
            return
        except PermissionError as error:
            last_permission_error = error
            if attempt < 4:
                time.sleep(0.05 * (2 ** attempt))

    with open(temporary_path, "rb") as source:
        contents = source.read()
    try:
        with open(target_path, "wb") as target:
            target.write(contents)
            target.flush()
            os.fsync(target.fileno())
    except OSError as error:
        raise PermissionError(f"Could not save session data at {target_path}") from (
            last_permission_error or error
        )


def save_session_goal_outcome(session_data, outcome):
    if outcome not in {"Yes", "Partially", "Not yet"}:
        return False
    session_id = str(session_data.get("session_id") or "")
    if not session_id or not session_data.get("session_completed"):
        return False

    profile = load_profile()
    entry = next(
        (item for item in profile["session_history"] if str(item.get("session_id") or "") == session_id),
        None,
    )
    if entry is None:
        return False

    session_data["goal_outcome"] = outcome
    session_path = user_data_file("session_data.json")
    temporary_path = session_path + ".tmp"
    try:
        with open(temporary_path, "w", encoding="utf-8") as file:
            json.dump(session_data, file, indent=2)
            file.flush()
            os.fsync(file.fileno())
        replace_with_retry(temporary_path, session_path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)

    entry["goal_outcome"] = outcome
    save_profile(profile)
    return True


def save_goal_outcome_from_widget(session_id, widget_key):
    session_data = load_live_data()
    outcome = st.session_state.get(widget_key)
    if save_session_goal_outcome(session_data, outcome):
        st.session_state[f"saved_goal_outcome_{session_id}"] = outcome
    else:
        st.session_state[f"saved_goal_outcome_{session_id}"] = ""


def render_session_results(profile):
    page_header(
        "SESSION RESULTS",
        "A reflection on your session.",
        "A short review based only on the final statistics recorded by FocusMate.",
    )
    if webcam_session_active():
        st.info("Your session is still running. The reflection will be available after it ends.")
        return

    session_data = load_live_data()
    reflection = create_session_reflection_if_needed(session_data)
    if reflection is None:
        st.info("Finish a webcam session to see its reflection here. No camera frames are sent for analysis.")
        return

    newly_earned = award_profile_achievements({"self_aware"})
    if any(item["id"] == "self_aware" for item in newly_earned):
        st.toast("Achievement unlocked · Self-Aware")

    if reflection["source"] == "AI-generated":
        st.success("AI-generated reflection")
    else:
        st.info("Local fallback reflection · the AI service was unavailable")
    st.markdown("### AI Session Reflection")
    st.write(reflection["summary"])

    went_well_col, try_next_col = st.columns(2, gap="large")
    with went_well_col:
        st.subheader("What went well")
        for item in reflection["what_went_well"]:
            st.markdown(f"- {item}")
    with try_next_col:
        st.subheader("Try next time")
        for item in reflection["try_next"]:
            st.markdown(f"- {item}")

    stats = reflection["stats"]
    st.write("")
    first, second, third = st.columns(3)
    first.metric("Focus estimate", f"{stats['focus_score']:g} / 100")
    second.metric("Session duration", f"{stats['duration_minutes']:g} min")
    total_alerts = sum(stats["alert_counts"].values())
    third.metric("Recorded signals", total_alerts)
    st.caption("Supportive study observations only. This is not a medical assessment.")
    challenge_xp = bounded_int(session_data.get("focus_challenge_xp"), 0, 0, 100_000)
    unlocked_achievements = session_data.get("achievements_unlocked", [])
    if challenge_xp:
        st.success(f"🎯 Focus challenge complete · +{challenge_xp} XP")
    if isinstance(unlocked_achievements, list) and unlocked_achievements:
        names = [
            str(item.get("title"))
            for item in unlocked_achievements
            if isinstance(item, dict) and item.get("title")
        ]
        if names:
            st.markdown("**Achievements unlocked:** " + " · ".join(names))

    session_id = str(session_data.get("session_id") or "")
    session_goal = str(session_data.get("study_goal") or "").strip()
    if session_goal and session_id:
        st.divider()
        st.subheader("Your session goal")
        st.write(session_goal)
        if session_data.get("study_subject"):
            st.caption(f"Subject: {session_data['study_subject']}")
        if session_data.get("linked_task"):
            st.caption(f"Task: {session_data['linked_task']}")

        saved_outcome = str(session_data.get("goal_outcome") or "")
        outcome_options = ["Choose one", "Yes", "Partially", "Not yet"]
        outcome_index = outcome_options.index(saved_outcome) if saved_outcome in outcome_options else 0
        widget_key = f"goal_outcome_{session_id}"
        st.selectbox(
            "Goal completed?",
            outcome_options,
            index=outcome_index,
            key=widget_key,
            on_change=save_goal_outcome_from_widget,
            args=(session_id, widget_key),
        )
        saved_outcome = st.session_state.get(f"saved_goal_outcome_{session_id}") or session_data.get("goal_outcome")
        if saved_outcome in {"Yes", "Partially", "Not yet"}:
            st.success(f"Goal check-in saved: {saved_outcome}")


def quest_is_claimed(profile, quest_id):
    today = date.today().isoformat()
    return any(
        isinstance(item, dict)
        and item.get("quest_id") == quest_id
        and item.get("date") == today
        for item in profile["quest_claims"]
    )


def sprint_is_unlocked(profile, live):
    try:
        live_seconds = int(float(live.get("session_seconds", 0) or 0))
    except (TypeError, ValueError):
        live_seconds = 0
    live_ok = (
        bool(live.get("session_active"))
        and live_snapshot_is_fresh(live)
        and live_seconds >= 900
    )
    today = date.today()
    history_ok = any(
        item["seconds"] >= 900
        for item in normalized_history(profile)
        if item["date"] == today
    )
    timer_ok = int(profile.get("focus_timer_seconds_today", 0) or 0) >= 900
    return live_ok or history_ok or timer_ok


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
                unlocked = award_profile_achievements(set())
                if unlocked:
                    st.toast(f"Achievement unlocked · {unlocked[0]['title']}")
                st.rerun()
    st.caption("Self-care quests are self-reported. Take breaks because they feel right for you—not for a reward.")


def render_achievements(profile):
    page_header(
        "ACHIEVEMENTS",
        "Small wins add up.",
        "Earn badges for showing up, building routines, and reaching your own study milestones.",
    )
    earned_ids = achievement_earned_ids(profile)
    earned_count = sum(item["id"] in earned_ids for item in ACHIEVEMENT_DEFINITIONS)
    st.progress(earned_count / len(ACHIEVEMENT_DEFINITIONS), text=f"{earned_count} of {len(ACHIEVEMENT_DEFINITIONS)} achievements unlocked")
    unlocked_at = {
        LEGACY_ACHIEVEMENT_IDS.get(str(item.get("id")), str(item.get("id"))): item.get("earned_at")
        for item in profile.get("achievements", [])
        if isinstance(item, dict) and item.get("id")
    }
    groups = {
        "Sessions & focus": {
            "first_step", "locked_in", "time_keeper", "half_hour_hero", "hour_of_focus",
            "getting_started", "focused_mind", "consistency", "dedicated_student", "focus_master",
            "sharp_start", "level_up", "personal_best", "ninety_club", "perfect_estimate",
            "comeback", "getting_better", "quick_focus", "long_haul", "keep_going", "no_quit",
        },
        "Streaks & routines": {
            "two_day_streak", "three_day_streak", "seven_day_streak", "fourteen_day_streak",
            "thirty_day_streak", "focused_week", "study_routine", "routine_builder",
        },
        "Study habits": {
            "posture_pro", "sit_smart", "perfect_distance", "eyes_forward", "steady_session", "clean_session",
        },
        "Study time & XP": {
            "persistence", "time_builder", "study_veteran", "twenty_hour_club", "fifty_hour_club",
            "xp_collector", "xp_hunter", "xp_champion",
        },
        "Goals & reflection": {
            "explorer", "goal_getter", "self_aware", "ai_reflection", "focusmate_legend",
        },
    }
    for group_name, achievement_ids in groups.items():
        entries = [item for item in ACHIEVEMENT_DEFINITIONS if item["id"] in achievement_ids]
        group_earned = sum(item["id"] in earned_ids for item in entries)
        with st.expander(f"{group_name} · {group_earned}/{len(entries)}", expanded=group_name == "Sessions & focus"):
            for start in range(0, len(entries), 2):
                columns = st.columns(2, gap="small")
                for column, item in zip(columns, entries[start:start + 2]):
                    is_earned = item["id"] in earned_ids
                    with column:
                        with st.container(border=True):
                            st.markdown(f"**{'🏆' if is_earned else '🔒'} {item['title']}**")
                            st.caption(item["description"])
                            if is_earned:
                                st.caption(f"Unlocked · +{item['xp']} XP")
                            else:
                                st.caption(f"Reward · +{item['xp']} XP")
                            if item["id"] == "eyes_forward" and not any(
                                    entry.get("looking_away_detection_available") is True
                                    for entry in profile.get("session_history", [])
                                    if isinstance(entry, dict)
                            ):
                                st.caption("Locked until looking-away detection is available.")
                            elif is_earned and unlocked_at.get(item["id"]):
                                st.caption(f"Earned {str(unlocked_at[item['id']])[:10]}")


def render_session_preferences(profile):
    default_prefs = fresh_profile()["session_preferences"]
    stored_prefs = {**default_prefs, **(profile.get("session_preferences") or {})}
    prefs = dict(stored_prefs)
    username_key = normalize_username(profile.get("username"))

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
                ("Focus monitoring", "Use the webcam locally for face, eye, posture, and distance signals", "focus_monitoring"),
                ("Posture alerts", "Show a gentle reminder when the detector reports slouching", "posture_alerts"),
                ("Mood check-ins", "Ask how I feel before my first webcam session each day", "mood_checkins"),
                ("Session chimes", "Play a soft tone at the start and end of a focus block", "session_chimes"),
            ]
            for label, caption, key_name in rows:
                c1, c2 = st.columns([5, 1])
                with c1:
                    st.markdown(
                        f'<div class="settings-label">{html.escape(label)}'
                        f'<span class="settings-caption">{html.escape(caption)}</span></div>',
                        unsafe_allow_html=True,
                    )
                with c2:
                    prefs[key_name] = st.toggle(
                        label,
                        value=bool(stored_prefs.get(key_name, default_prefs.get(key_name, False))),
                        key=f"pref_{username_key}_{key_name}",
                        label_visibility="collapsed",
                    )
            prefs["session_length_minutes"] = int(st.number_input(
                "Default focus block (minutes)",
                min_value=15,
                max_value=120,
                step=5,
                value=int(stored_prefs.get("session_length_minutes", 25) or 25),
                key=f"pref_{username_key}_session_length_minutes",
            ))
            prefs["daily_goal_minutes"] = int(st.number_input(
                "Daily study goal (minutes)",
                min_value=30,
                max_value=720,
                step=15,
                value=int(stored_prefs.get("daily_goal_minutes", 180) or 180),
                key=f"pref_{username_key}_daily_goal_minutes",
            ))
            st.markdown('</div>', unsafe_allow_html=True)

        monitoring_was_enabled = bool(stored_prefs.get("focus_monitoring", True))
        if prefs != stored_prefs:
            latest = load_profile()
            latest["session_preferences"] = prefs
            save_profile(latest)
        if monitoring_was_enabled and not prefs["focus_monitoring"] and webcam_session_active():
            stopped, message = stop_webcam()
            (st.success if stopped else st.warning)(
                "Focus monitoring turned off. " + message
                if stopped
                else "Focus monitoring is off, but the camera could not be stopped: " + message
            )
            st.rerun()

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
                f'<div class="profile-line"><div class="profile-key">{html.escape(key)}</div>'
                f'<div class="profile-value">{html.escape(str(value))}</div></div>',
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
            st.text_input(
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
            latest["water_glasses_today"] = int(water)
            latest["water_glasses_last_reset"] = date.today().isoformat()
            save_profile(latest)
            st.success("Your check-in has been saved.")
            st.rerun()

    with right:
        st.subheader("Your data, your choice")
        st.markdown(
            "FocusMate stores your profile and completed-session history as local JSON files "
            "inside the dashboard folder. Live camera frames are processed locally and are not saved."
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


# ---------------------------------------------------------------------------
# App entry point
# ---------------------------------------------------------------------------

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
    advance_focus_timer(profile)
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
    render_shared_camera_panel(live)
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
                title="My Progress",
                icon=":material/monitoring:",
                url_path="insights",
            ),
            st.Page(
                lambda: render_session_results(profile),
                title="Session results",
                icon=":material/auto_awesome:",
                url_path="session-results",
            ),
        ],
        "Build good habits": [
            st.Page(
                lambda: render_achievements(profile),
                title="Achievements",
                icon=":material/emoji_events:",
                url_path="achievements",
            ),
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
    session_results_page = pages["Your space"][3]
    focus_room_page = pages["Your space"][1]
    page = st.navigation(pages, position="sidebar")
    if st.session_state.pop("focusmate_open_session_results", False):
        st.switch_page(session_results_page)
    if st.session_state.pop("focusmate_open_focus_room", False):
        st.switch_page(focus_room_page)
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