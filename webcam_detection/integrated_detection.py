import cv2
import math
import time
import json
import os
import uuid
import numpy as np
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


# ============================================================
# SETTINGS
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Resolve model files next to this script (override with env vars if needed)
FACE_MODEL = os.environ.get("FOCUSMATE_FACE_MODEL", os.path.join(BASE_DIR, "face_landmarker.task"))
POSE_MODEL = os.environ.get("FOCUSMATE_POSE_MODEL", os.path.join(BASE_DIR, "pose_landmarker.task"))

EAR_THRESHOLD = 0.20
POSTURE_THRESHOLD = 60
POSTURE_XP_PER_MINUTE = 2

EVENT_DELAY = 2.0            # seconds a signal must persist before it counts
DISTANCE_THRESHOLD = 0.12    # relative face width (not centimeters)

HISTORY_INTERVAL = 5.0
SESSION_WRITE_INTERVAL = 1.0

# Watchdogs so an orphaned detector never runs forever
SERVER_TIMEOUT = 30.0        # dashboard server unreachable this long -> finish
FRAME_IDLE_TIMEOUT = 120.0   # session running but no new frames -> finish
CAMERA_WAIT_TIMEOUT = 600.0  # nobody ever enabled the camera -> exit


# ============================================================
# FILE PATHS
# ============================================================

SESSION_FILE = os.path.abspath(os.environ.get(
    "FOCUSMATE_SESSION_FILE",
    os.path.join(BASE_DIR, "..", "dashboard", "session_data.json")
))
PROFILE_FILE = os.path.abspath(os.environ.get(
    "FOCUSMATE_PROFILE_FILE",
    os.path.join(os.path.dirname(SESSION_FILE), "player_profile.json")
))
FRAME_OUTPUT = os.path.abspath(os.environ.get(
    "FOCUSMATE_FRAME_FILE",
    os.path.join(os.path.dirname(SESSION_FILE), "latest_frame.jpg")
))
CAMERA_FRAME_URL = os.environ.get("FOCUSMATE_CAMERA_FRAME_URL", "")
CAMERA_TOKEN = os.environ.get("FOCUSMATE_CAMERA_TOKEN", "")

STOP_FILE = os.path.abspath(os.environ.get(
    "FOCUSMATE_STOP_FILE",
    os.path.join(os.path.dirname(SESSION_FILE), "stop_session.request")
))


# ============================================================
# LANDMARKERS
# ============================================================

face_detector = vision.FaceLandmarker.create_from_options(
    vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=FACE_MODEL),
        num_faces=1,
    )
)

pose_detector = vision.PoseLandmarker.create_from_options(
    vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=POSE_MODEL),
        num_poses=1,
    )
)


# ============================================================
# HELPERS
# ============================================================

def distance(p1, p2, width=1.0, height=1.0):
    """Distance between two landmarks. Pass the frame size to measure in
    pixels; normalized x/y have different scales on non-square frames."""
    return math.sqrt(
        ((p1.x - p2.x) * width) ** 2 +
        ((p1.y - p2.y) * height) ** 2
    )


def calculate_ear(landmarks, p1, p2, p3, p4, p5, p6, width, height):
    vertical_1 = distance(landmarks[p2], landmarks[p6], width, height)
    vertical_2 = distance(landmarks[p3], landmarks[p5], width, height)
    horizontal = distance(landmarks[p1], landmarks[p4], width, height)

    if horizontal == 0:
        return 0

    return (vertical_1 + vertical_2) / (2.0 * horizontal)


def calculate_posture_angle(shoulder, ear):
    # Kept in normalized coordinates on purpose: POSTURE_THRESHOLD was tuned
    # against this formula, so changing it would change what counts as slouching.
    dx = abs(ear.x - shoulder.x)
    dy = abs(ear.y - shoulder.y)
    return math.degrees(math.atan2(dy, dx))


LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]


# ============================================================
# FOCUS MONITOR
# ============================================================

class FocusMonitor:

    def __init__(self):
        self.session_started = False
        self.session_start_time = None
        self.session_end_time = None
        self.session_id = None
        self.session_completed = False
        self.last_session_write = 0.0
        self.posture_beep_triggered = False
        self.posture_bad_since = None
        self.posture_beep_token = None
        self.posture_beep_pending = False
        self.good_posture_seconds = 0.0
        self.last_posture_sample_time = None

        self.events = []
        self.score = 100.0

        self.looking_away_start = None
        self.slouching_start = None
        self.eyes_closed_start = None
        self.face_missing_start = None
        self.distance_alert_start = None

        self.looking_away_count = 0
        self.slouching_count = 0
        self.eye_closure_count = 0
        self.face_missing_count = 0
        self.distance_alert_count = 0

        self.looking_away_seconds = 0.0
        self.slouching_seconds = 0.0
        self.eye_closure_seconds = 0.0
        self.face_missing_seconds = 0.0
        self.distance_alert_seconds = 0.0

        self.history = []
        self.last_history_time = None

    # --------------------------------------------------------
    def _clock(self):
        """Current time, frozen at the session end once finished."""
        return self.session_end_time if self.session_end_time else time.time()

    def _duration(self):
        if not self.session_start_time:
            return 0.0
        return max(0.0, self._clock() - self.session_start_time)

    # --------------------------------------------------------
    # SESSION
    # --------------------------------------------------------

    def start_session(self):
        self.session_started = True
        self.session_start_time = time.time()
        self.session_end_time = None
        self.session_id = str(uuid.uuid4())
        self.session_completed = False

        self.events = []
        self.score = 100.0

        self.looking_away_start = None
        self.slouching_start = None
        self.eyes_closed_start = None
        self.face_missing_start = None
        self.distance_alert_start = None

        self.looking_away_count = 0
        self.slouching_count = 0
        self.eye_closure_count = 0
        self.face_missing_count = 0
        self.distance_alert_count = 0

        self.looking_away_seconds = 0.0
        self.slouching_seconds = 0.0
        self.eye_closure_seconds = 0.0
        self.face_missing_seconds = 0.0
        self.distance_alert_seconds = 0.0

        self.history = []
        self.last_history_time = time.time()
        self.last_session_write = 0.0
        self.posture_beep_triggered = False
        self.posture_bad_since = None
        self.posture_beep_token = None
        self.posture_beep_pending = False
        self.good_posture_seconds = 0.0
        self.last_posture_sample_time = None

        self.events.append({"type": "SESSION_STARTED", "time": datetime.now().isoformat()})
        self.add_history()

    def end_session(self):
        if not self.session_started:
            return self.get_summary()

        now = time.time()

        # Close active states so their final durations are counted
        for state in ("looking_away", "slouching", "eyes_closed", "face_missing", "distance_alert"):
            self.update_state(state, False, now)

        # Score/duration are computed against this fixed end time
        self.session_end_time = now
        self.add_history(force=True)

        self.session_started = False
        self.session_completed = True

        self.events.append({"type": "SESSION_ENDED", "time": datetime.now().isoformat()})

        self.write_session_data()

        # Persist lifetime progress independently of the dashboard being open.
        # The session ID is recorded once, preventing duplicate XP.
        try:
            profile_file = PROFILE_FILE
            profile = {
                "version": 1,
                "total_xp": 0,
                "total_study_seconds": 0,
                "sessions_completed": 0,
                "quest_claims": [],
                "achievements": [],
                "session_history": [],
                "last_session_id": None,
                "created_at": datetime.now().isoformat(),
            }
            if os.path.exists(profile_file):
                try:
                    with open(profile_file, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                    if isinstance(loaded, dict):
                        profile.update(loaded)
                except (json.JSONDecodeError, OSError):
                    pass

            history = profile.get("session_history", [])
            if not isinstance(history, list):
                history = []
            already_saved = any(
                str(item.get("session_id")) == str(self.session_id)
                for item in history if isinstance(item, dict)
            )
            seconds = max(0, int(self.get_summary().get("session_duration", 0)))
            if self.session_id and not already_saved:
                study_xp = (seconds // 60) * 2
                posture_xp = int(self.good_posture_seconds // 60) * POSTURE_XP_PER_MINUTE
                earned_xp = study_xp + posture_xp
                profile["total_xp"] = int(profile.get("total_xp", 0)) + earned_xp
                profile["total_study_seconds"] = int(profile.get("total_study_seconds", 0)) + seconds
                profile["sessions_completed"] = int(profile.get("sessions_completed", 0)) + 1
                history.append({
                    "session_id": self.session_id,
                    "date": datetime.now().isoformat(),
                    "seconds": seconds,
                    "xp": earned_xp,
                    "study_xp": study_xp,
                    "posture_xp": posture_xp,
                    "good_posture_seconds": round(self.good_posture_seconds),
                    "wellbeing_note": "Session completed",
                })
                profile["session_history"] = history[-500:]
                profile["last_session_id"] = self.session_id

                os.makedirs(os.path.dirname(profile_file), exist_ok=True)
                temp_profile = profile_file + ".tmp"
                with open(temp_profile, "w", encoding="utf-8") as f:
                    json.dump(profile, f, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(temp_profile, profile_file)
        except Exception as error:
            print(f"Could not save lifetime player progress: {error}")

        return self.get_summary()

    # --------------------------------------------------------
    # EVENT HANDLING
    # --------------------------------------------------------

    def update_state(self, state_name, active, now):
        start_attribute = f"{state_name}_start"
        start_time = getattr(self, start_attribute)

        if active:
            if start_time is None:
                setattr(self, start_attribute, now)
            elif now - start_time >= EVENT_DELAY:
                if not any(
                    event.get("type") == state_name.upper() and event.get("active")
                    for event in self.events
                ):
                    self.events.append({
                        "type": state_name.upper(),
                        "active": True,
                        "time": datetime.now().isoformat(),
                    })
        else:
            if start_time is not None:
                duration = now - start_time
                if duration >= EVENT_DELAY:
                    self.events.append({
                        "type": state_name.upper(),
                        "active": False,
                        "duration": round(duration, 2),
                        "time": datetime.now().isoformat(),
                    })
                    self._add_duration(state_name, duration)
                setattr(self, start_attribute, None)

    def _add_duration(self, state_name, duration):
        if state_name == "looking_away":
            self.looking_away_seconds += duration
            self.looking_away_count += 1
        elif state_name == "slouching":
            self.slouching_seconds += duration
            self.slouching_count += 1
        elif state_name == "eyes_closed":
            self.eye_closure_seconds += duration
            self.eye_closure_count += 1
        elif state_name == "face_missing":
            self.face_missing_seconds += duration
            self.face_missing_count += 1
        elif state_name == "distance_alert":
            self.distance_alert_seconds += duration
            self.distance_alert_count += 1

    # --------------------------------------------------------
    # SCORE
    # --------------------------------------------------------

    def calculate_score(self):
        now = self._clock()
        session_seconds = max(
            1.0,
            now - self.session_start_time if self.session_start_time else 1.0,
        )
        signal_weights = (
            ("eyes_closed", self.eye_closure_seconds, 0.35),
            ("face_missing", self.face_missing_seconds, 0.30),
            ("slouching", self.slouching_seconds, 0.20),
            ("distance_alert", self.distance_alert_seconds, 0.15),
        )

        weighted_signal_time = 0.0
        for state_name, recorded_seconds, weight in signal_weights:
            state_started = getattr(self, f"{state_name}_start")
            active_seconds = max(0.0, now - state_started) if state_started is not None else 0.0
            signal_fraction = min(1.0, (recorded_seconds + active_seconds) / session_seconds)
            weighted_signal_time += signal_fraction * weight

        return round(100 * (1.0 - weighted_signal_time), 1)

    # --------------------------------------------------------
    # HISTORY
    # --------------------------------------------------------

    def add_history(self, force=False):
        if not self.session_started:
            return

        now = time.time()

        if not force and self.last_history_time is not None:
            if now - self.last_history_time < HISTORY_INTERVAL:
                return

        self.history.append({
            "minute": round(self._duration() / 60, 2),
            "focus_score": self.calculate_score(),
            "posture_alerts": self.slouching_count,
            "distance_alerts": self.distance_alert_count,
            "looking_away_alerts": self.looking_away_count,
            "fatigue_signals": self.eye_closure_count,
        })
        self.history = self.history[-120:]
        self.last_history_time = now

    # --------------------------------------------------------
    # WRITE JSON (atomic)
    # --------------------------------------------------------

    def write_session_data(self):
        duration = self._duration()

        data = {
            "session_active": self.session_started,
            "session_id": self.session_id,
            "session_started_at": (
                datetime.fromtimestamp(self.session_start_time).isoformat()
                if self.session_start_time else None
            ),
            "session_completed": self.session_completed,
            "session_seconds": round(duration, 1),
            "focus_score": self.calculate_score(),
            "posture_alerts": self.slouching_count,
            "good_posture_seconds": round(self.good_posture_seconds, 1),
            "distance_alerts": self.distance_alert_count,
            "looking_away_alerts": self.looking_away_count,
            # Eye-closure events are fatigue-related signals, NOT a diagnosis.
            "fatigue_signals": self.eye_closure_count,
            "session_minutes": round(duration / 60, 2),
            "history": self.history,
            "status": getattr(self, "current_status", "Starting"),
            "posture": getattr(self, "current_posture", "Unknown"),
            "posture_beep_pending": bool(self.posture_beep_pending),
            "posture_beep_token": self.posture_beep_token,
            "distance_status": getattr(self, "current_distance_status", "Unknown"),
            "looking_away": getattr(self, "current_looking_away", False),
            "eyes_closed": getattr(self, "current_eyes_closed", False),
            "face_detected": getattr(self, "current_face_detected", False),
            "ear": getattr(self, "current_ear", None),
            "posture_angle": getattr(self, "current_posture_angle", None),
            "last_updated": datetime.now().isoformat(),
        }

        temp_file = SESSION_FILE + ".tmp"
        try:
            os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
            with open(temp_file, "w", encoding="utf-8") as file:
                json.dump(data, file, indent=4)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temp_file, SESSION_FILE)
        except Exception as error:
            print(f"Could not write session data: {error}")

    # --------------------------------------------------------
    # PROCESS FRAME
    # --------------------------------------------------------

    def process_frame(self, frame):
        now = time.time()
        frame_height, frame_width = frame.shape[:2]

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # ---------------- FACE ----------------
        face_result = face_detector.detect(mp_image)
        face_detected = bool(face_result.face_landmarks)

        ear = None
        eyes_closed = False

        if face_detected:
            landmarks = face_result.face_landmarks[0]
            # Pixel-scaled so the 0.20 threshold means the same thing on
            # 16:9 and 4:3 frames (normalized coords would inflate EAR).
            left_ear = calculate_ear(landmarks, *LEFT_EYE, frame_width, frame_height)
            right_ear = calculate_ear(landmarks, *RIGHT_EYE, frame_width, frame_height)
            ear = (left_ear + right_ear) / 2
            eyes_closed = ear < EAR_THRESHOLD

        # ---------------- POSTURE ----------------
        posture = "Unknown"
        posture_angle = None

        pose_result = pose_detector.detect(mp_image)
        if pose_result and pose_result.pose_landmarks:
            landmarks = pose_result.pose_landmarks[0]
            posture_angle = calculate_posture_angle(landmarks[11], landmarks[7])
            posture = "Slouching" if posture_angle < POSTURE_THRESHOLD else "Good"

        # ---------------- LOOKING AWAY ----------------
        # Not reliably measurable from one nose landmark; reported as False.
        looking_away = False

        # ---------------- DISTANCE ----------------
        face_width = None
        distance_alert = False
        distance_status = "Unknown"

        if face_detected:
            landmarks = face_result.face_landmarks[0]
            face_width = distance(landmarks[234], landmarks[454])
            if face_width < DISTANCE_THRESHOLD:
                distance_alert = True
                distance_status = "Too Far"
            else:
                distance_status = "Good"

        # ---------------- UPDATE SESSION ----------------
        if self.session_started:
            previous_posture = getattr(self, "current_posture", "Unknown")
            if self.last_posture_sample_time is not None and previous_posture == "Good":
                elapsed = max(0.0, now - self.last_posture_sample_time)
                self.good_posture_seconds += min(elapsed, 2.0)
            self.last_posture_sample_time = now

            self.update_state("looking_away", looking_away, now)
            self.update_state("slouching", posture == "Slouching", now)
            self.update_state("eyes_closed", eyes_closed, now)
            self.update_state("face_missing", not face_detected, now)
            self.update_state("distance_alert", distance_alert, now)

            self.score = self.calculate_score()
            self.add_history()

        # ---------------- STATUS ----------------
        if not face_detected:
            status = "Face Not Detected"
        elif looking_away:
            status = "Looking Away"
        elif eyes_closed:
            status = "Eyes Closed"
        elif posture == "Slouching":
            status = "Slouching"
        elif distance_alert:
            status = "Too Far"
        else:
            status = "Focused"

        self.current_status = status
        self.current_posture = posture
        self.current_distance_status = distance_status
        self.current_looking_away = looking_away
        self.current_eyes_closed = eyes_closed
        self.current_face_detected = face_detected
        self.current_ear = round(ear, 3) if ear is not None else None
        self.current_posture_angle = round(posture_angle, 2) if posture_angle is not None else None

        if posture == "Slouching":
            if self.posture_bad_since is None:
                self.posture_bad_since = now
                self.posture_beep_triggered = False
            elif now - self.posture_bad_since >= 600 and not self.posture_beep_triggered:
                self.posture_beep_triggered = True
                self.posture_beep_token = int(time.time())
                self.posture_beep_pending = True
        else:
            self.posture_bad_since = None
            self.posture_beep_triggered = False
            self.posture_beep_pending = False
            self.posture_beep_token = None

        # ---------------- WRITE DASHBOARD DATA ----------------
        if self.session_started and now - self.last_session_write >= SESSION_WRITE_INTERVAL:
            self.write_session_data()
            self.last_session_write = now

        return {
            "focus_score": self.score,
            "status": status,
            "face_detected": face_detected,
            "eyes_closed": eyes_closed,
            "ear": ear,
            "posture": posture,
            "posture_angle": posture_angle,
            "looking_away": looking_away,
            "distance_alert": distance_alert,
            "distance_status": distance_status,
            "face_width": face_width,
            "session_active": self.session_started,
            "events": self.events[-10:],
        }

    # --------------------------------------------------------
    # SUMMARY
    # --------------------------------------------------------

    def get_summary(self):
        return {
            "focus_score": self.calculate_score(),
            "session_duration": round(self._duration(), 1),
            "looking_away_count": self.looking_away_count,
            "looking_away_seconds": round(self.looking_away_seconds, 1),
            "slouching_count": self.slouching_count,
            "slouching_seconds": round(self.slouching_seconds, 1),
            "eye_closure_count": self.eye_closure_count,
            "eye_closure_seconds": round(self.eye_closure_seconds, 1),
            "face_missing_count": self.face_missing_count,
            "face_missing_seconds": round(self.face_missing_seconds, 1),
            "distance_alert_count": self.distance_alert_count,
            "distance_alert_seconds": round(self.distance_alert_seconds, 1),
            "events": self.events,
        }


# ============================================================
# GRACEFUL STOP SUPPORT
# ============================================================

def stop_requested():
    return os.path.exists(STOP_FILE)


def clear_stop_request():
    try:
        if os.path.exists(STOP_FILE):
            os.remove(STOP_FILE)
    except OSError as error:
        print(f"Could not clear stop request: {error}")


# ============================================================
# MAIN PROGRAM
# ============================================================

if __name__ == "__main__":

    monitor = FocusMonitor()

    clear_stop_request()
    if os.path.exists(FRAME_OUTPUT):
        try:
            os.remove(FRAME_OUTPUT)
        except OSError:
            pass
    last_console_update = 0.0

    print()
    print("====================================")
    print("       FOCUSMATE AI STARTING")
    print("====================================")
    print()

    try:
        if not CAMERA_FRAME_URL or not CAMERA_TOKEN:
            print("FOCUSMATE_CAMERA_FRAME_URL / FOCUSMATE_CAMERA_TOKEN are not set.")
            print("Start this detector from the FocusMate dashboard.")
            raise SystemExit(1)

        print("Waiting for browser camera permission...")
        print()
        print("Session data:", SESSION_FILE)
        print()
        print("Use Stop camera in the dashboard to end the session.")
        print()

        last_browser_frame = None
        last_server_ok = time.monotonic()
        last_frame_time = time.monotonic()
        last_http_error = None

        while True:

            # ------------------------------------------------
            # DASHBOARD STOP REQUEST
            # ------------------------------------------------
            if stop_requested():
                print()
                print("Dashboard requested session end.")
                break

            # ------------------------------------------------
            # WATCHDOGS
            # ------------------------------------------------
            clock = time.monotonic()
            if clock - last_server_ok > SERVER_TIMEOUT:
                print()
                print("Dashboard server is unreachable. Ending session.")
                break
            idle_limit = FRAME_IDLE_TIMEOUT if monitor.session_started else CAMERA_WAIT_TIMEOUT
            if clock - last_frame_time > idle_limit:
                print()
                print("No camera frames received. Ending session.")
                break

            # ------------------------------------------------
            # FETCH THE LATEST FRAME UPLOADED BY THE BROWSER
            # ------------------------------------------------
            try:
                request_headers = (
                    {"If-None-Match": last_browser_frame} if last_browser_frame else {}
                )
                frame_request = Request(
                    f"{CAMERA_FRAME_URL}?token={CAMERA_TOKEN}",
                    headers=request_headers,
                )
                with urlopen(frame_request, timeout=2) as response:
                    frame_signature = response.headers.get("ETag")
                    encoded_frame = response.read()
            except HTTPError as error:
                # The server answered, so it is alive; the request itself was refused.
                last_server_ok = time.monotonic()
                if error.code != last_http_error:
                    last_http_error = error.code
                    print(f"Frame request refused (HTTP {error.code}). "
                          "Check that the camera token matches this session.")
                time.sleep(0.5)
                continue
            except (OSError, URLError):
                time.sleep(0.1)
                continue

            last_server_ok = time.monotonic()
            last_http_error = None

            if not encoded_frame or frame_signature == last_browser_frame:
                time.sleep(0.1)
                continue
            last_browser_frame = frame_signature

            frame = cv2.imdecode(
                np.frombuffer(encoded_frame, dtype=np.uint8),
                cv2.IMREAD_COLOR,
            )
            if frame is None:
                continue
            last_frame_time = time.monotonic()

            if not monitor.session_started:
                monitor.start_session()
                print("Webcam detection: ACTIVE")
                print("Session ID:", monitor.session_id)

            # ------------------------------------------------
            # PROCESS FRAME
            # ------------------------------------------------
            data = monitor.process_frame(frame)

            if time.monotonic() - last_console_update >= 5.0:
                print(
                    f"Score: {data['focus_score']} | "
                    f"Status: {data['status']} | "
                    f"Eyes: {data['eyes_closed']} | "
                    f"Posture: {data['posture']} | "
                    f"Away: {data['looking_away']} | "
                    f"Distance: {data['distance_status']}"
                )
                last_console_update = time.monotonic()

    except KeyboardInterrupt:
        print()
        print("Session interrupted. Saving progress...")

    except Exception as error:
        print()
        print("Webcam error:", error)

    finally:

        try:
            if monitor.session_started:
                summary = monitor.end_session()
            else:
                summary = monitor.get_summary()
        except Exception as error:
            print("Could not finalize session:", error)
            summary = monitor.get_summary()

        # The browser owns the camera device; nothing to release here.
        if os.path.exists(FRAME_OUTPUT):
            try:
                os.remove(FRAME_OUTPUT)
            except OSError:
                pass

        try:
            if os.path.exists(STOP_FILE):
                os.remove(STOP_FILE)
        except OSError as error:
            print("Could not remove stop request:", error)

        print()
        print("====================================")
        print("          SESSION SUMMARY")
        print("====================================")
        print(f"Focus Score: {summary['focus_score']}/100")
        print(f"Session Duration: {summary['session_duration']} seconds")
        print(f"Looking Away: {summary['looking_away_count']} times")
        print(f"Slouching: {summary['slouching_count']} times")
        print(f"Eye Closure: {summary['eye_closure_count']} times")
        print(f"Distance Alerts: {summary['distance_alert_count']} times")
        print()
        print("Session data saved to:")
        print(SESSION_FILE)
        print("Player profile:")
        print(PROFILE_FILE)
        print("====================================")
