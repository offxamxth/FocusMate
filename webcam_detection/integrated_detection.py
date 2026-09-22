import cv2
import math
import time
import json
import os
from datetime import datetime


import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


# ============================================================
# SETTINGS
# ============================================================

FACE_MODEL = "face_landmarker.task"
POSE_MODEL = "pose_landmarker.task"

EAR_THRESHOLD = 0.20
POSTURE_THRESHOLD = 60

# How long something must happen before it becomes an event
EVENT_DELAY = 1.0

# Distance threshold
# This is a relative webcam-based estimate, not a real-world
# centimeter measurement.
DISTANCE_THRESHOLD = 0.18

# How often history is recorded
HISTORY_INTERVAL = 5.0


# ============================================================
# FILE PATHS
# ============================================================

# This points to the EXISTING dashboard/session_data.json
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SESSION_FILE = os.path.abspath(
    os.path.join(
        BASE_DIR,
        "..",
        "dashboard",
        "session_data.json"
    )
)


# ============================================================
# LANDMARKERS
# ============================================================

face_base_options = python.BaseOptions(
    model_asset_path=FACE_MODEL
)

face_options = vision.FaceLandmarkerOptions(
    base_options=face_base_options,
    num_faces=1
)

face_detector = vision.FaceLandmarker.create_from_options(
    face_options
)


pose_base_options = python.BaseOptions(
    model_asset_path=POSE_MODEL
)

pose_options = vision.PoseLandmarkerOptions(
    base_options=pose_base_options,
    num_poses=1
)

pose_detector = vision.PoseLandmarker.create_from_options(
    pose_options
)


# ============================================================
# HELPERS
# ============================================================

def distance(p1, p2):
    return math.sqrt(
        (p1.x - p2.x) ** 2 +
        (p1.y - p2.y) ** 2
    )


def calculate_ear(landmarks, p1, p2, p3, p4, p5, p6):

    vertical_1 = distance(
        landmarks[p2],
        landmarks[p6]
    )

    vertical_2 = distance(
        landmarks[p3],
        landmarks[p5]
    )

    horizontal = distance(
        landmarks[p1],
        landmarks[p4]
    )

    if horizontal == 0:
        return 0

    return (
        vertical_1 + vertical_2
    ) / (2.0 * horizontal)


def calculate_posture_angle(shoulder, ear):

    dx = abs(ear.x - shoulder.x)
    dy = abs(ear.y - shoulder.y)

    return math.degrees(
        math.atan2(dy, dx)
    )


# ============================================================
# EYE LANDMARKS
# ============================================================

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]


# ============================================================
# FOCUS MONITOR
# ============================================================

class FocusMonitor:

    def __init__(self):

        self.session_started = False
        self.session_start_time = None

        self.events = []

        self.score = 100.0

        # State timers
        self.looking_away_start = None
        self.slouching_start = None
        self.eyes_closed_start = None
        self.face_missing_start = None
        self.distance_alert_start = None

        # Event counts
        self.looking_away_count = 0
        self.slouching_count = 0
        self.eye_closure_count = 0
        self.face_missing_count = 0
        self.distance_alert_count = 0

        # Total durations
        self.looking_away_seconds = 0.0
        self.slouching_seconds = 0.0
        self.eye_closure_seconds = 0.0
        self.face_missing_seconds = 0.0
        self.distance_alert_seconds = 0.0

        # History
        self.history = []
        self.last_history_time = None

    # ========================================================
    # SESSION
    # ========================================================

    def start_session(self):

        self.session_started = True
        self.session_start_time = time.time()

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

        self.events.append({
            "type": "SESSION_STARTED",
            "time": datetime.now().isoformat()
        })

        # Immediately create first history point
        self.add_history()

    # ========================================================
    # END SESSION
    # ========================================================

    def end_session(self):

        if not self.session_started:
            return self.get_summary()

        # Close any active states so their final duration is counted
        now = time.time()

        self.update_state(
            "looking_away",
            False,
            now
        )

        self.update_state(
            "slouching",
            False,
            now
        )

        self.update_state(
            "eyes_closed",
            False,
            now
        )

        self.update_state(
            "face_missing",
            False,
            now
        )

        self.update_state(
            "distance_alert",
            False,
            now
        )

        self.add_history(force=True)

        self.session_started = False

        self.events.append({
            "type": "SESSION_ENDED",
            "time": datetime.now().isoformat()
        })

        # Write final session data
        self.write_session_data()

        return self.get_summary()

    # ========================================================
    # EVENT HANDLING
    # ========================================================

    def update_state(self, state_name, active, now):

        start_attribute = f"{state_name}_start"

        start_time = getattr(
            self,
            start_attribute
        )

        if active:

            if start_time is None:

                setattr(
                    self,
                    start_attribute,
                    now
                )

            elif now - start_time >= EVENT_DELAY:

                # Only create one active event
                if not any(
                    event.get("type") == state_name.upper()
                    and event.get("active")
                    for event in self.events
                ):

                    self.events.append({
                        "type": state_name.upper(),
                        "active": True,
                        "time": datetime.now().isoformat()
                    })

        else:

            if start_time is not None:

                duration = now - start_time

                if duration >= EVENT_DELAY:

                    self.events.append({
                        "type": state_name.upper(),
                        "active": False,
                        "duration": round(duration, 2),
                        "time": datetime.now().isoformat()
                    })

                    self._add_duration(
                        state_name,
                        duration
                    )

                setattr(
                    self,
                    start_attribute,
                    None
                )

    # ========================================================
    # ADD DURATION
    # ========================================================

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

    # ========================================================
    # SCORE
    # ========================================================

    def calculate_score(self):

        score = 100

        score -= self.looking_away_seconds * 0.5
        score -= self.eye_closure_seconds * 0.3
        score -= self.slouching_seconds * 0.2
        score -= self.face_missing_seconds * 0.2
        score -= self.distance_alert_seconds * 0.2

        return round(
            max(0, min(100, score)),
            1
        )

    # ========================================================
    # HISTORY
    # ========================================================

    def add_history(self, force=False):

        if not self.session_started:
            return

        now = time.time()

        if not force:

            if self.last_history_time is not None:

                if now - self.last_history_time < HISTORY_INTERVAL:
                    return

        duration = 0

        if self.session_start_time:

            duration = now - self.session_start_time

        minute = max(
            1,
            math.ceil(duration / 60)
        )

        history_entry = {
            "minute": minute,
            "focus_score": self.calculate_score(),
            "posture_alerts": self.slouching_count,
            "distance_alerts": self.distance_alert_count,
            "looking_away_alerts": self.looking_away_count,
            "fatigue_signals": self.eye_closure_count
        }

        self.history.append(history_entry)

        # Keep only the latest 120 points
        self.history = self.history[-120:]

        self.last_history_time = now

    # ========================================================
    # WRITE JSON
    # ========================================================

    def write_session_data(self):

        duration = 0

        if self.session_start_time:

            duration = time.time() - self.session_start_time

        session_minutes = round(
            duration / 60,
            2
        )

        data = {

            # Dashboard fields
            "session_active": self.session_started,

            "focus_score": self.calculate_score(),

            "posture_alerts":
                self.slouching_count,

            "distance_alerts":
                self.distance_alert_count,

            "looking_away_alerts":
                self.looking_away_count,

            # Eye-closure events are represented as
            # fatigue-related signals, NOT a diagnosis.
            "fatigue_signals":
                self.eye_closure_count,

            "session_minutes":
                session_minutes,

            # Step 7 analytics
            "history":
                self.history,

            # Extra live information
            "status":
                getattr(
                    self,
                    "current_status",
                    "Starting"
                ),

            "posture":
                getattr(
                    self,
                    "current_posture",
                    "Unknown"
                ),

            "distance_status":
                getattr(
                    self,
                    "current_distance_status",
                    "Unknown"
                ),

            "looking_away":
                getattr(
                    self,
                    "current_looking_away",
                    False
                ),

            "eyes_closed":
                getattr(
                    self,
                    "current_eyes_closed",
                    False
                ),

            "face_detected":
                getattr(
                    self,
                    "current_face_detected",
                    False
                ),

            "ear":
                getattr(
                    self,
                    "current_ear",
                    None
                ),

            "posture_angle":
                getattr(
                    self,
                    "current_posture_angle",
                    None
                ),

            "last_updated":
                datetime.now().isoformat()
        }

        # ====================================================
        # ATOMIC WRITE
        # ====================================================
        #
        # The dashboard may read the file at the same time.
        # Writing to a temporary file first prevents the
        # dashboard from reading an incomplete JSON file.
        # ====================================================

        temp_file = SESSION_FILE + ".tmp"

        try:

            os.makedirs(
                os.path.dirname(SESSION_FILE),
                exist_ok=True
            )

            with open(
                temp_file,
                "w",
                encoding="utf-8"
            ) as file:

                json.dump(
                    data,
                    file,
                    indent=4
                )

                file.flush()
                os.fsync(file.fileno())

            os.replace(
                temp_file,
                SESSION_FILE
            )

        except Exception as error:

            print(
                f"Could not write session data: {error}"
            )

    # ========================================================
    # PROCESS FRAME
    # ========================================================

    def process_frame(self, frame):

        now = time.time()

        rgb_frame = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2RGB
        )

        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=rgb_frame
        )

        # ----------------------------------------------------
        # FACE
        # ----------------------------------------------------

        face_result = face_detector.detect(
            mp_image
        )

        face_detected = bool(
            face_result.face_landmarks
        )

        ear = None
        eyes_closed = False

        if face_detected:

            landmarks = face_result.face_landmarks[0]

            left_ear = calculate_ear(
                landmarks,
                *LEFT_EYE
            )

            right_ear = calculate_ear(
                landmarks,
                *RIGHT_EYE
            )

            ear = (
                left_ear + right_ear
            ) / 2

            eyes_closed = (
                ear < EAR_THRESHOLD
            )

        # ----------------------------------------------------
        # POSTURE
        # ----------------------------------------------------

        posture = "Unknown"
        posture_angle = None

        if pose_result := pose_detector.detect(mp_image):

            if pose_result.pose_landmarks:

                landmarks = pose_result.pose_landmarks[0]

                left_shoulder = landmarks[11]
                left_ear = landmarks[7]

                posture_angle = calculate_posture_angle(
                    left_shoulder,
                    left_ear
                )

                if posture_angle < POSTURE_THRESHOLD:

                    posture = "Slouching"

                else:

                    posture = "Good"

        # ----------------------------------------------------
        # LOOKING AWAY
        # ----------------------------------------------------

        looking_away = False

        if face_detected:

            landmarks = face_result.face_landmarks[0]

            nose = landmarks[1]

            if nose.x < 0.30 or nose.x > 0.70:

                looking_away = True

        # ----------------------------------------------------
        # DISTANCE
        # ----------------------------------------------------
        #
        # Relative estimate using face width.
        #
        # A smaller face width generally means the person
        # is farther from the camera.
        #
        # This is NOT a centimeter measurement.
        # ----------------------------------------------------

        face_width = None
        distance_alert = False
        distance_status = "Unknown"

        if face_detected:

            landmarks = face_result.face_landmarks[0]

            left_side = landmarks[234]
            right_side = landmarks[454]

            face_width = distance(
                left_side,
                right_side
            )

            if face_width < DISTANCE_THRESHOLD:

                distance_alert = True
                distance_status = "Too Far"

            else:

                distance_status = "Good"

        # ----------------------------------------------------
        # UPDATE SESSION
        # ----------------------------------------------------

        if self.session_started:

            self.update_state(
                "looking_away",
                looking_away,
                now
            )

            self.update_state(
                "slouching",
                posture == "Slouching",
                now
            )

            self.update_state(
                "eyes_closed",
                eyes_closed,
                now
            )

            self.update_state(
                "face_missing",
                not face_detected,
                now
            )

            self.update_state(
                "distance_alert",
                distance_alert,
                now
            )

            self.score = self.calculate_score()

            # Record history every few seconds
            self.add_history()

        # ----------------------------------------------------
        # STATUS
        # ----------------------------------------------------

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

        # ----------------------------------------------------
        # SAVE CURRENT VALUES
        # ----------------------------------------------------

        self.current_status = status

        self.current_posture = posture

        self.current_distance_status = distance_status

        self.current_looking_away = looking_away

        self.current_eyes_closed = eyes_closed

        self.current_face_detected = face_detected

        self.current_ear = (
            round(ear, 3)
            if ear is not None
            else None
        )

        self.current_posture_angle = (
            round(posture_angle, 2)
            if posture_angle is not None
            else None
        )

        # ----------------------------------------------------
        # WRITE DASHBOARD DATA
        # ----------------------------------------------------

        if self.session_started:

            self.write_session_data()

        # ----------------------------------------------------
        # RETURN DATA
        # ----------------------------------------------------

        return {

            "focus_score":
                self.score,

            "status":
                status,

            "face_detected":
                face_detected,

            "eyes_closed":
                eyes_closed,

            "ear":
                ear,

            "posture":
                posture,

            "posture_angle":
                posture_angle,

            "looking_away":
                looking_away,

            "distance_alert":
                distance_alert,

            "distance_status":
                distance_status,

            "face_width":
                face_width,

            "session_active":
                self.session_started,

            "events":
                self.events[-10:]
        }

    # ========================================================
    # SUMMARY
    # ========================================================

    def get_summary(self):

        duration = 0

        if self.session_start_time:

            duration = (
                time.time()
                - self.session_start_time
            )

        return {

            "focus_score":
                self.calculate_score(),

            "session_duration":
                round(
                    duration,
                    1
                ),

            "looking_away_count":
                self.looking_away_count,

            "looking_away_seconds":
                round(
                    self.looking_away_seconds,
                    1
                ),

            "slouching_count":
                self.slouching_count,

            "slouching_seconds":
                round(
                    self.slouching_seconds,
                    1
                ),

            "eye_closure_count":
                self.eye_closure_count,

            "eye_closure_seconds":
                round(
                    self.eye_closure_seconds,
                    1
                ),

            "face_missing_count":
                self.face_missing_count,

            "face_missing_seconds":
                round(
                    self.face_missing_seconds,
                    1
                ),

            "distance_alert_count":
                self.distance_alert_count,

            "distance_alert_seconds":
                round(
                    self.distance_alert_seconds,
                    1
                ),

            "events":
                self.events
        }


# ============================================================
# QUICK TEST / MAIN PROGRAM
# ============================================================

if __name__ == "__main__":

    monitor = FocusMonitor()

    monitor.start_session()

    cap = cv2.VideoCapture(0)

    if not cap.isOpened():

        print(
            "Could not open webcam"
        )

        exit()

    print()
    print("====================================")
    print("       FOCUSMATE AI RUNNING")
    print("====================================")
    print()
    print("Webcam detection: ACTIVE")
    print("Dashboard connection: ACTIVE")
    print()
    print("Session data:")
    print(SESSION_FILE)
    print()
    print("Press Q to end the session.")
    print()

    try:

        while True:

            success, frame = cap.read()

            if not success:

                print(
                    "Could not read webcam frame."
                )

                break

            data = monitor.process_frame(
                frame
            )

            print(
                f"Score: {data['focus_score']} | "
                f"Status: {data['status']} | "
                f"Eyes: {data['eyes_closed']} | "
                f"Posture: {data['posture']} | "
                f"Away: {data['looking_away']} | "
                f"Distance: {data['distance_status']}"
            )

            cv2.imshow(
                "FocusMate AI",
                frame
            )

            if (
                cv2.waitKey(1) & 0xFF
                == ord("q")
            ):

                break

    except KeyboardInterrupt:

        print()
        print(
            "Session interrupted."
        )

    finally:

        cap.release()

        cv2.destroyAllWindows()

        summary = monitor.end_session()

        print()
        print("====================================")
        print("          SESSION SUMMARY")
        print("====================================")

        print(
            f"Focus Score: "
            f"{summary['focus_score']}/100"
        )

        print(
            f"Session Duration: "
            f"{summary['session_duration']} seconds"
        )

        print(
            f"Looking Away: "
            f"{summary['looking_away_count']} times"
        )

        print(
            f"Slouching: "
            f"{summary['slouching_count']} times"
        )

        print(
            f"Eye Closure: "
            f"{summary['eye_closure_count']} times"
        )

        print(
            f"Distance Alerts: "
            f"{summary['distance_alert_count']} times"
        )

        print()
        print(
            "Session data saved to:"
        )

        print(SESSION_FILE)

        print("====================================")