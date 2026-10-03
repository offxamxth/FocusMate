"""Local JSON and webcam API for the React FocusMate dashboard."""

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import threading
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen


HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE_DIR = os.path.join(HERE, "profiles")
WEBCAM_DIR = os.path.abspath(os.path.join(HERE, "..", "webcam_detection"))
WEBCAM_FILE = os.path.join(WEBCAM_DIR, "integrated_detection.py")
WEBCAM_PYTHON = os.environ.get("FOCUSMATE_WEBCAM_PYTHON") or sys.executable
HOST = os.environ.get("FOCUSMATE_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("FOCUSMATE_API_PORT", "8765"))
LOCK = threading.RLock()
PROCESSES = {}
TOKENS = {}
FRAMES = {}


def normalize_username(value):
    username = str(value or "").strip().lstrip("@").casefold()
    return username if len(username) <= 32 and re.fullmatch(r"[a-z0-9_.-]+", username or "") else ""


def user_key(username):
    return hashlib.sha256(username.encode("utf-8")).hexdigest()[:32]


def user_dir(username):
    return os.path.join(PROFILE_DIR, user_key(username))


def profile_path(username):
    return os.path.join(user_dir(username), "player_profile.json")


def live_path(username):
    return os.path.join(user_dir(username), "session_data.json")


def fresh_profile(username="focusfriend", name="Focus friend"):
    return {
        "username": username,
        "player_name": name,
        "total_xp": 0,
        "sessions_completed": 0,
        "total_study_seconds": 0,
        "session_history": [],
        "session_reflections": [],
        "achievements": [],
        "quest_claims": [],
        "tasks": [],
        "active_session_plan": {},
        "session_wellbeing": {"sleep_hours": 0, "water_glasses": 0, "reflection": ""},
        "water_glasses_today": 0,
        "water_glasses_last_reset": date.today().isoformat(),
        "focus_timer_seconds_today": 0,
        "focus_timer_date": date.today().isoformat(),
        "focus_timer_total_seconds": 0,
        "focus_timer_history": [],
        "session_preferences": {
            "focus_monitoring": True,
            "posture_alerts": True,
            "mood_checkins": True,
            "session_chimes": False,
            "session_length_minutes": 25,
            "daily_goal_minutes": 180,
        },
    }


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(value, file, indent=2, ensure_ascii=False)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)


def load_profile(username):
    profile = read_json(profile_path(username), None)
    legacy = os.path.join(HERE, "player_profile.json")
    if not isinstance(profile, dict):
        candidate = read_json(legacy, None)
        profile = candidate if isinstance(candidate, dict) and normalize_username(candidate.get("username")) == username else None
    profile = profile if isinstance(profile, dict) else fresh_profile(username)
    defaults = fresh_profile(username)
    for key, value in defaults.items():
        profile.setdefault(key, value)
    profile["username"] = username
    profile["player_name"] = str(profile.get("player_name") or "Focus friend")[:80]
    for key in ("session_history", "session_reflections", "achievements", "quest_claims", "tasks", "focus_timer_history"):
        if not isinstance(profile.get(key), list):
            profile[key] = []
    preferences = profile.get("session_preferences")
    wellbeing = profile.get("session_wellbeing")
    profile["session_preferences"] = {**defaults["session_preferences"], **(preferences if isinstance(preferences, dict) else {})}
    profile["session_wellbeing"] = {**defaults["session_wellbeing"], **(wellbeing if isinstance(wellbeing, dict) else {})}
    today = date.today().isoformat()
    if profile.get("water_glasses_last_reset") != today:
        profile["water_glasses_today"] = 0
        profile["water_glasses_last_reset"] = today
    if profile.get("focus_timer_date") != today:
        profile["focus_timer_seconds_today"] = 0
        profile["focus_timer_date"] = today
    return profile


def load_live(username):
    value = read_json(live_path(username), {})
    return value if isinstance(value, dict) else {}


def safe_int(value, fallback=0, minimum=0, maximum=2**63 - 1):
    try:
        return max(minimum, min(maximum, int(value)))
    except (TypeError, ValueError, OverflowError):
        return fallback


class FocusMateHandler(BaseHTTPRequestHandler):
    server_version = "FocusMate/1.0"

    def log_message(self, *_args):
        return

    def send_json(self, status, data):
        if status == 204:
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def read_body(self):
        length = safe_int(self.headers.get("Content-Length"), 0, 0, 2_000_000)
        body = self.rfile.read(length)
        if self.headers.get("Content-Type", "").startswith("application/json"):
            try:
                value = json.loads(body or b"{}")
                return value if isinstance(value, dict) else {}
            except json.JSONDecodeError:
                return {}
        return body

    def username(self, query):
        username = normalize_username(query.get("username", [""])[0])
        if not username:
            raise ValueError("Enter a valid username.")
        return username

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/health":
            self.send_json(200, {"ok": True})
            return
        if parsed.path.startswith("/api/camera/frame/"):
            key = parsed.path.removeprefix("/api/camera/frame/")
            supplied = query.get("token", [""])[0]
            if not secrets.compare_digest(supplied, TOKENS.get(key, "")):
                self.send_json(403, {"error": "Camera token expired."})
                return
            frame = FRAMES.get(key)
            if not frame:
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(frame)
            return
        if parsed.path == "/api/state":
            try:
                username = self.username(query)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
                return
            self.send_json(200, {"profile": load_profile(username), "live": load_live(username)})
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/login":
            data = self.read_body()
            username = normalize_username(data.get("username"))
            name = str(data.get("name") or "").strip()[:80]
            if not username:
                self.send_json(400, {"error": "Enter a username using letters, numbers, dots, dashes, or underscores."})
                return
            path = profile_path(username)
            existing = os.path.isfile(path)
            profile = load_profile(username)
            if not existing:
                if not name:
                    self.send_json(400, {"error": "Enter your name to create a new profile."})
                    return
                profile["player_name"] = name
                write_json(path, profile)
            self.send_json(200, {"profile": profile, "live": load_live(username), "existing": existing})
            return
        if parsed.path == "/api/camera/frame":
            key = query.get("key", [""])[0]
            supplied = query.get("token", [""])[0]
            if not secrets.compare_digest(supplied, TOKENS.get(key, "")):
                self.send_json(403, {"error": "Camera token expired."})
                return
            frame = self.read_body()
            if not isinstance(frame, bytes) or len(frame) < 4 or len(frame) > 1_500_000 or not frame.startswith(b"\xff\xd8"):
                self.send_json(400, {"error": "Invalid camera frame."})
                return
            FRAMES[key] = frame
            self.send_json(204, {})
            return
        if parsed.path in ("/api/webcam/start", "/api/webcam/stop", "/api/timer/credit", "/api/quests/claim", "/api/session/goal", "/api/session/reflection"):
            try:
                username = self.username(query)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
                return
            data = self.read_body()
            with LOCK:
                if parsed.path == "/api/webcam/start":
                    result = self.start_webcam(username, data)
                elif parsed.path == "/api/webcam/stop":
                    result = self.stop_webcam(username)
                elif parsed.path == "/api/timer/credit":
                    result = self.credit_timer(username, data)
                elif parsed.path == "/api/quests/claim":
                    result = self.claim_quest(username, data)
                elif parsed.path == "/api/session/reflection":
                    result = self.mark_reflection_viewed(username)
                else:
                    result = self.save_goal(username, data)
            status = 200 if result.get("ok") else 400
            self.send_json(status, result)
            return
        self.send_json(404, {"error": "Not found."})

    def do_PUT(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        if parsed.path != "/api/state":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            username = self.username(query)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        data = self.read_body()
        profile = data.get("profile")
        if not isinstance(profile, dict):
            self.send_json(400, {"error": "Profile data is required."})
            return
        with LOCK:
            current = load_profile(username)
            profile["username"] = username
            profile["player_name"] = str(profile.get("player_name") or current["player_name"])[:80]
            profile["total_xp"] = safe_int(profile.get("total_xp"), 0)
            profile["tasks"] = [item for item in profile.get("tasks", []) if isinstance(item, dict)][-100:]
            profile["session_history"] = [item for item in profile.get("session_history", []) if isinstance(item, dict)][-1000:]
            write_json(profile_path(username), profile)
        self.send_json(200, {"profile": load_profile(username)})

    def start_webcam(self, username, data):
        key = user_key(username)
        running = PROCESSES.get(key)
        if running is not None and running.poll() is None:
            return {"ok": True, "message": "Your study session is already running.", "token": TOKENS.get(key), "key": key}
        profile = load_profile(username)
        if not profile.get("session_preferences", {}).get("focus_monitoring", True):
            return {"ok": False, "message": "Webcam monitoring is turned off in session preferences."}
        if not os.path.isfile(WEBCAM_FILE) or not os.path.isfile(WEBCAM_PYTHON):
            return {"ok": False, "message": "The webcam detector or its Python executable could not be found."}
        try:
            check = subprocess.run([WEBCAM_PYTHON, "-c", "import cv2, mediapipe"], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.TimeoutExpired) as error:
            return {"ok": False, "message": f"Could not check the webcam environment: {error}"}
        if check.returncode:
            return {"ok": False, "message": "MediaPipe and OpenCV are not available in the configured webcam Python environment."}
        directory = user_dir(username)
        os.makedirs(directory, exist_ok=True)
        stop_file = os.path.join(directory, "stop_session.request")
        if os.path.exists(stop_file):
            os.remove(stop_file)
        token = secrets.token_urlsafe(24)
        TOKENS[key] = token
        FRAMES.pop(key, None)
        profile["active_session_plan"] = {
            "subject": str(data.get("subject") or "Other")[:40],
            "goal": str(data.get("goal") or "")[:200],
        }
        if data.get("mood"):
            wellbeing = profile.get("session_wellbeing", {})
            wellbeing.update({"mood": str(data["mood"]), "mood_checkin_date": date.today().isoformat(), "mood_updated_at": datetime.now().isoformat()})
            profile["session_wellbeing"] = wellbeing
        write_json(profile_path(username), profile)
        environment = os.environ.copy()
        environment.update({
            "FOCUSMATE_SESSION_FILE": live_path(username),
            "FOCUSMATE_PROFILE_FILE": profile_path(username),
            "FOCUSMATE_FRAME_FILE": os.path.join(directory, "latest_frame.jpg"),
            "FOCUSMATE_STOP_FILE": stop_file,
            "FOCUSMATE_CAMERA_FRAME_URL": f"http://{HOST}:{PORT}/api/camera/frame/{key}",
            "FOCUSMATE_CAMERA_TOKEN": token,
        })
        try:
            PROCESSES[key] = subprocess.Popen([WEBCAM_PYTHON, WEBCAM_FILE], cwd=WEBCAM_DIR, env=environment)
        except OSError as error:
            TOKENS.pop(key, None)
            return {"ok": False, "message": f"Could not start the webcam detector: {error}"}
        return {"ok": True, "message": "Your webcam study session has started.", "token": token, "key": key}

    def stop_webcam(self, username):
        key = user_key(username)
        process = PROCESSES.get(key)
        if process is None or process.poll() is not None:
            return {"ok": False, "message": "There is no running webcam session to stop."}
        stop_file = os.path.join(user_dir(username), "stop_session.request")
        with open(stop_file, "w", encoding="utf-8") as file:
            file.write("stop")
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        PROCESSES.pop(key, None)
        TOKENS.pop(key, None)
        FRAMES.pop(key, None)
        frame_path = os.path.join(user_dir(username), "latest_frame.jpg")
        if os.path.exists(frame_path):
            os.remove(frame_path)
        live = load_live(username)
        profile = load_profile(username)
        session_id = str(live.get("session_id") or "")
        history_entry = next((item for item in profile["session_history"] if str(item.get("session_id") or "") == session_id), None)
        if live.get("session_completed") and history_entry and not history_entry.get("game_rewards_applied"):
            plan = profile.get("active_session_plan") or {}
            seconds = safe_int(live.get("session_seconds"), 0, 0, 86_400)
            challenge_count = seconds // 600
            challenge_xp = challenge_count * 25
            history_entry.update({
                "subject": str(plan.get("subject") or "Other"),
                "goal": str(plan.get("goal") or "")[:200],
                "task_id": str(plan.get("task_id") or ""),
                "task_text": str(plan.get("task_text") or "")[:120],
                "focus_score": safe_int(live.get("focus_score"), 0, 0, 100),
                "session_started_at": live.get("session_started_at"),
                "posture_alerts": safe_int(live.get("posture_alerts")),
                "distance_alerts": safe_int(live.get("distance_alerts")),
                "looking_away_alerts": safe_int(live.get("looking_away_alerts")),
                "fatigue_signals": safe_int(live.get("fatigue_signals")),
                "focus_challenge_xp": challenge_xp,
                "challenge_count": challenge_count,
                "game_rewards_applied": True,
            })
            profile["total_xp"] = safe_int(profile.get("total_xp")) + challenge_xp
            history_entry["xp"] = safe_int(history_entry.get("xp")) + challenge_xp
            profile["active_session_plan"] = {}
            live.update({"study_subject": history_entry["subject"], "study_goal": history_entry["goal"], "focus_challenge_xp": challenge_xp})
            earned = {str(item.get("id")) for item in profile["achievements"] if item.get("id")}
            session_count = len(profile["session_history"])
            score = safe_int(live.get("focus_score"), 0, 0, 100)
            duration_thresholds = ((15 * 60, "time_keeper", "Time Keeper", 15), (30 * 60, "half_hour_hero", "Half Hour Hero", 20), (45 * 60, "long_haul", "Long Haul", 30), (60 * 60, "hour_of_focus", "Hour of Focus", 30))
            eligible = [("first_step", "First Step", "Complete your first study session.", 15)] if session_count >= 1 else []
            eligible.extend((achievement_id, title, "Complete a study milestone.", reward) for seconds_needed, achievement_id, title, reward in duration_thresholds if seconds >= seconds_needed)
            eligible.extend((achievement_id, title, "Reach a focus estimate of 90 or higher.", 20) for achievement_id, title in (("locked_in", "Locked In"), ("ninety_club", "90 Club")) if score >= 90)
            if safe_int(live.get("posture_alerts")) == 0:
                eligible.append(("posture_pro", "Posture Pro", "Complete a session with no posture alerts.", 20))
            if safe_int(live.get("distance_alerts")) == 0:
                eligible.append(("perfect_distance", "Perfect Distance", "Complete a session with no distance alerts.", 20))
            if safe_int(live.get("posture_alerts")) == 0 and safe_int(live.get("distance_alerts")) == 0:
                eligible.append(("steady_session", "Steady Session", "Complete a session with no posture or distance alerts.", 35))
            if not any(safe_int(live.get(key)) for key in ("posture_alerts", "distance_alerts", "looking_away_alerts", "fatigue_signals")):
                eligible.append(("clean_session", "Clean Session", "Complete a session with no recorded alerts.", 50))
            if score == 100:
                eligible.append(("perfect_estimate", "Perfect Estimate", "Reach a focus score of 100.", 50))
            newly_earned = []
            for achievement_id, title, description, reward in eligible:
                if achievement_id in earned:
                    continue
                record = {"id": achievement_id, "title": title, "description": description, "xp": reward, "earned_at": datetime.now().isoformat()}
                profile["achievements"].append(record)
                newly_earned.append(record)
                earned.add(achievement_id)
                profile["total_xp"] = safe_int(profile.get("total_xp")) + reward
                history_entry["xp"] = safe_int(history_entry.get("xp")) + reward
            history_entry["achievements_unlocked"] = [item["id"] for item in newly_earned]
            history_entry["achievement_xp"] = sum(item["xp"] for item in newly_earned)
            live["achievements_unlocked"] = newly_earned
            profile["session_reflections"] = profile.get("session_reflections", [])
            reflection = self.build_reflection(live)
            profile["session_reflections"].append(reflection)
            profile["session_reflections"] = profile["session_reflections"][-100:]
            write_json(profile_path(username), profile)
            write_json(live_path(username), live)
        return {"ok": True, "message": "Session ended. Your progress has been saved.", "live": live}

    def build_reflection(self, live):
        session_id = str(live.get("session_id") or "")
        seconds = max(0, min(86_400, float(live.get("session_seconds") or 0)))
        minutes = round(seconds / 60, 1)
        score = safe_int(live.get("focus_score"), 0, 0, 100)
        alerts = {
            "posture": safe_int(live.get("posture_alerts")),
            "screen_distance": safe_int(live.get("distance_alerts")),
            "looking_away": safe_int(live.get("looking_away_alerts")),
            "fatigue_related": safe_int(live.get("fatigue_signals")),
        }
        summary = (
            f"You maintained a strong focus estimate of {score}/100 during this {minutes:g}-minute session."
            if score >= 80 else
            f"Your focus estimate was generally steady at {score}/100 during this {minutes:g}-minute session, with some interruptions."
            if score >= 60 else
            f"This {minutes:g}-minute session had several attention-related interruptions, with a focus estimate of {score}/100."
        )
        went_well = [f"You completed {minutes:g} minutes of study time."]
        if live.get("posture") == "Good":
            went_well.append("Your final posture signal was good.")
        elif alerts["posture"] == 0:
            went_well.append("No posture alerts were recorded.")
        options = (
            ("posture", "Try a quick posture check when you change tasks."),
            ("screen_distance", "Adjust your seat or screen to keep a comfortable distance."),
            ("looking_away", "Before the next block, choose one small task and reduce nearby distractions."),
            ("fatigue_related", "If you notice tiredness, try a short break before your next focus block."),
        )
        highest = max((alerts[key] for key, _ in options), default=0)
        try_next = [next(text for key, text in options if alerts[key] == highest)] if highest else ["Keep the setup that worked for you and take a short break before your next block."]
        return {"session_id": session_id, "generated_at": datetime.now().isoformat(), "source": "Fallback", "summary": summary, "what_went_well": went_well[:2], "try_next": try_next, "stats": {"focus_score": score, "duration_minutes": minutes, "alert_counts": alerts, "final_signals": {"posture": live.get("posture", "Unknown"), "screen_distance": live.get("distance_status", "Unknown")}}}

    def mark_reflection_viewed(self, username):
        profile = load_profile(username)
        earned = {str(item.get("id")) for item in profile["achievements"] if item.get("id")}
        if "self_aware" not in earned and profile.get("session_reflections"):
            profile["achievements"].append({"id": "self_aware", "title": "Self-Aware", "description": "View your reflection after completing a session.", "xp": 10, "earned_at": datetime.now().isoformat()})
            profile["total_xp"] = safe_int(profile.get("total_xp")) + 10
            write_json(profile_path(username), profile)
        return {"ok": True, "profile": profile}

    def credit_timer(self, username, data):
        profile = load_profile(username)
        seconds = safe_int(data.get("seconds"), 0, 0, 86400)
        if not seconds:
            return {"ok": False, "message": "No study time to save."}
        today = date.today().isoformat()
        profile["focus_timer_seconds_today"] = safe_int(profile.get("focus_timer_seconds_today")) + seconds
        profile["focus_timer_total_seconds"] = safe_int(profile.get("focus_timer_total_seconds")) + seconds
        history = profile.get("focus_timer_history", [])
        if history and history[-1].get("date") == today:
            history[-1]["seconds"] = safe_int(history[-1].get("seconds")) + seconds
        else:
            history.append({"date": today, "seconds": seconds})
        profile["focus_timer_history"] = history[-730:]
        write_json(profile_path(username), profile)
        return {"ok": True, "profile": profile}

    def claim_quest(self, username, data):
        quests = {"focus_sprint": 30, "recharge": 15, "hydration": 10, "reflection": 10}
        quest_id = str(data.get("quest_id") or "")
        if quest_id not in quests:
            return {"ok": False, "message": "Unknown quest."}
        profile = load_profile(username)
        today = date.today().isoformat()
        if quest_id == "focus_sprint":
            today_seconds = safe_int(profile.get("focus_timer_seconds_today"))
            today_seconds += sum(safe_int(item.get("seconds")) for item in profile["session_history"] if str(item.get("date", ""))[:10] == today)
            if today_seconds < 900 and not (load_live(username).get("session_active") and safe_int(load_live(username).get("session_seconds")) >= 900):
                return {"ok": False, "message": "Complete a 15-minute study session to unlock this quest."}
        if any(item.get("quest_id") == quest_id and item.get("date") == today for item in profile["quest_claims"]):
            return {"ok": False, "message": "This quest has already been claimed today."}
        profile["total_xp"] = safe_int(profile.get("total_xp")) + quests[quest_id]
        profile["quest_claims"].append({"quest_id": quest_id, "date": today, "xp": quests[quest_id], "claimed_at": datetime.now().isoformat()})
        write_json(profile_path(username), profile)
        return {"ok": True, "profile": profile}

    def save_goal(self, username, data):
        outcome = data.get("outcome")
        if outcome not in ("Yes", "Partially", "Not yet"):
            return {"ok": False, "message": "Choose a goal outcome."}
        session = load_live(username)
        if not session.get("session_completed"):
            return {"ok": False, "message": "The session is not complete yet."}
        session["goal_outcome"] = outcome
        profile = load_profile(username)
        for item in profile["session_history"]:
            if str(item.get("session_id") or "") == str(session.get("session_id") or ""):
                item["goal_outcome"] = outcome
        write_json(profile_path(username), profile)
        write_json(live_path(username), session)
        return {"ok": True, "live": session}


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), FocusMateHandler)
    print(f"FocusMate API listening at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()