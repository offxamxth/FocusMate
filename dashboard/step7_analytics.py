"""
FocusMate - Dashboard Module
STEP 7: Session Analytics + Webcam Connection

Features:
    - Reads the existing session_data.json
    - Connects to the webcam detection module through JSON
    - Automatic refresh every 3 seconds
    - Safe handling of missing/null webcam values
    - Live webcam connection status
    - Live posture, distance, attention and fatigue signals
    - Focus score progress
    - Session statistics
    - Focus score history chart
    - 3-stage competition structure
"""

import json
import os
from datetime import datetime

import pandas as pd
import streamlit as st
from streamlit_autorefresh import st_autorefresh


# =========================================================
# PAGE CONFIGURATION
# =========================================================

st.set_page_config(
    page_title="FocusMate",
    page_icon="🧠",
    layout="wide",
)


# =========================================================
# AUTOMATIC REFRESH
# =========================================================

st_autorefresh(
    interval=3000,
    key="focusmate_refresh"
)


# =========================================================
# SESSION DATA PATH
# =========================================================

DATA_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "session_data.json"
)


# =========================================================
# SAFE VALUE FUNCTIONS
# =========================================================

def safe_float(value, default=0.0):

    try:

        if value is None:
            return default

        return float(value)

    except (TypeError, ValueError):

        return default


def safe_int(value, default=0):

    try:

        if value is None:
            return default

        return int(value)

    except (TypeError, ValueError):

        return default


def safe_bool(value, default=False):

    if value is None:
        return default

    return bool(value)


# =========================================================
# LOAD SESSION DATA
# =========================================================

def load_session_data():

    try:

        with open(DATA_FILE, "r") as file:
            return json.load(file)

    except FileNotFoundError:

        st.error(
            "session_data.json was not found."
        )

        st.stop()

    except json.JSONDecodeError:

        st.warning(
            "The webcam is currently updating session_data.json. "
            "Waiting for the next refresh..."
        )

        st.stop()


data = load_session_data()


# =========================================================
# CURRENT SESSION VALUES
# =========================================================

focus_score = safe_float(
    data.get("focus_score"),
    0
)

posture_alerts = safe_int(
    data.get("posture_alerts"),
    0
)

distance_alerts = safe_int(
    data.get("distance_alerts"),
    0
)

looking_away_alerts = safe_int(
    data.get("looking_away_alerts"),
    0
)

fatigue_signals = safe_int(
    data.get("fatigue_signals"),
    0
)

session_minutes = safe_float(
    data.get("session_minutes"),
    0
)

session_active = safe_bool(
    data.get("session_active"),
    False
)


# =========================================================
# LIVE WEBCAM VALUES
# =========================================================

status = data.get(
    "status"
) or "Unknown"

posture = data.get(
    "posture"
) or "Unknown"

distance_status = data.get(
    "distance_status"
) or "Unknown"

looking_away = safe_bool(
    data.get("looking_away"),
    False
)

eyes_closed = safe_bool(
    data.get("eyes_closed"),
    False
)

face_detected = safe_bool(
    data.get("face_detected"),
    False
)

ear = safe_float(
    data.get("ear"),
    0
)

posture_angle = safe_float(
    data.get("posture_angle"),
    0
)

last_updated = data.get(
    "last_updated"
) or "Unknown"


# =========================================================
# SESSION HISTORY
# =========================================================

history = data.get(
    "history"
) or []

history_df = pd.DataFrame(history)


# =========================================================
# FOCUS STATUS
# =========================================================

if focus_score >= 80:

    focus_status = "Excellent"
    focus_icon = "🟢"

elif focus_score >= 60:

    focus_status = "Good"
    focus_icon = "🟡"

else:

    focus_status = "Needs Attention"
    focus_icon = "🔴"


# =========================================================
# TOTAL SIGNALS
# =========================================================

total_alerts = (
    posture_alerts
    + distance_alerts
    + looking_away_alerts
    + fatigue_signals
)


# =========================================================
# HEADER
# =========================================================

st.title("🧠 FocusMate")

st.caption(
    "AI-powered wellbeing support for healthier study sessions."
)


# =========================================================
# CONNECTION STATUS
# =========================================================

if session_active:

    st.success(
        "🟢 WEBCAM CONNECTED • LIVE SESSION ACTIVE"
    )

else:

    st.info(
        "⚪ WEBCAM MODULE CONNECTED • NO ACTIVE SESSION"
    )


# =========================================================
# LAST UPDATE
# =========================================================

if last_updated != "Unknown":

    try:

        updated_time = datetime.fromisoformat(
            last_updated
        )

        st.caption(
            f"Last webcam update: "
            f"{updated_time.strftime('%H:%M:%S')}"
        )

    except (ValueError, TypeError):

        st.caption(
            f"Last webcam update: {last_updated}"
        )


st.divider()


# =========================================================
# THREE-STAGE DEMO TABS
# =========================================================

tab1, tab2, tab3 = st.tabs(
    [
        "1️⃣ Introduce the Problem",
        "2️⃣ Live Challenge",
        "3️⃣ Reflection & Results",
    ]
)


# =========================================================
# TAB 1 — INTRODUCE THE PROBLEM
# =========================================================

with tab1:

    st.header("The Problem")

    st.write(
        "Students can spend long periods studying without noticing "
        "changes in posture, screen distance, or visual attention."
    )

    st.write(
        "These habits can be difficult to recognize while concentrating "
        "on schoolwork."
    )

    st.write(
        "**FocusMate uses computer vision signals to help students "
        "understand their study habits and receive simple wellbeing tips.**"
    )

    st.divider()

    st.subheader("How FocusMate Works")

    process_col1, process_col2, process_col3 = st.columns(3)

    with process_col1:

        st.markdown("### 👀 1. Observe")

        st.write(
            "The webcam observes signals such as posture, "
            "screen distance and visual attention."
        )

    with process_col2:

        st.markdown("### 📊 2. Understand")

        st.write(
            "The system converts detected events into useful "
            "session statistics."
        )

    with process_col3:

        st.markdown("### 💡 3. Improve")

        st.write(
            "FocusMate turns session results into simple "
            "personalized wellbeing suggestions."
        )

    st.divider()

    st.subheader("🔗 System Connection")

    st.code(
        """
📷 Webcam
     ↓
integrated_detection.py
     ↓
session_data.json
     ↓
📊 FocusMate Dashboard
        """,
        language="text",
    )

    st.success(
        "The webcam detection module and dashboard communicate "
        "through the existing session_data.json file."
    )


# =========================================================
# TAB 2 — LIVE CHALLENGE
# =========================================================

with tab2:

    st.header("🎯 Live Challenge")

    st.caption(
        "Real-time data from the webcam detection module."
    )

    # -----------------------------------------------------
    # WEBCAM CONNECTION
    # -----------------------------------------------------

    if session_active:

        st.success(
            "📷 Webcam is actively sending data to FocusMate."
        )

    else:

        st.info(
            "📷 Webcam module is connected, but the study session "
            "is currently inactive."
        )

    st.divider()

    # -----------------------------------------------------
    # MAIN METRICS
    # -----------------------------------------------------

    col1, col2, col3, col4 = st.columns(4)

    with col1:

        st.metric(
            "Focus Score",
            f"{focus_score:.1f}/100",
        )

    with col2:

        st.metric(
            "Posture Alerts",
            posture_alerts,
        )

    with col3:

        st.metric(
            "Looking Away",
            looking_away_alerts,
        )

    with col4:

        st.metric(
            "Session Time",
            f"{session_minutes:.2f} min",
        )

    st.divider()

    # -----------------------------------------------------
    # FOCUS SCORE
    # -----------------------------------------------------

    st.subheader(
        f"{focus_icon} Focus Level: {focus_status}"
    )

    st.progress(
        min(max(focus_score, 0), 100) / 100
    )

    st.write(
        f"Current focus score: **{focus_score:.1f}/100**"
    )

    st.divider()

    # -----------------------------------------------------
    # LIVE WEBCAM DETECTION
    # -----------------------------------------------------

    st.subheader("📷 Live Webcam Detection")

    live_col1, live_col2, live_col3, live_col4 = st.columns(4)

    # FACE

    with live_col1:

        if face_detected:

            st.success("🙂 Face Detected")

        else:

            st.warning("⚠️ Face Not Detected")

    # POSTURE

    with live_col2:

        if posture.lower() in [
            "good",
            "normal",
            "excellent",
        ]:

            st.success(
                f"🪑 Posture: {posture}"
            )

        else:

            st.warning(
                f"🪑 Posture: {posture}"
            )

    # DISTANCE

    with live_col3:

        if distance_status.lower() in [
            "good",
            "normal",
            "comfortable",
        ]:

            st.success(
                f"📏 Distance: {distance_status}"
            )

        else:

            st.warning(
                f"📏 Distance: {distance_status}"
            )

    # ATTENTION

    with live_col4:

        if looking_away:

            st.warning(
                "👀 Looking Away"
            )

        else:

            st.success(
                "👀 Attention OK"
            )

    st.divider()

    # -----------------------------------------------------
    # TECHNICAL LIVE VALUES
    # -----------------------------------------------------

    st.subheader("🔬 Live Detection Values")

    technical_col1, technical_col2, technical_col3 = st.columns(3)

    with technical_col1:

        if ear > 0:

            st.metric(
                "Eye Aspect Ratio",
                f"{ear:.3f}",
            )

        else:

            st.metric(
                "Eye Aspect Ratio",
                "N/A",
            )

    with technical_col2:

        if posture_angle > 0:

            st.metric(
                "Posture Angle",
                f"{posture_angle:.2f}°",
            )

        else:

            st.metric(
                "Posture Angle",
                "N/A",
            )

    with technical_col3:

        if eyes_closed:

            st.warning(
                "😴 Eyes Closed Signal"
            )

        else:

            st.success(
                "👁️ Eyes Open"
            )

    st.caption(
        "These are computer-vision measurements used by FocusMate. "
        "Fatigue signals are wellbeing indicators, not medical diagnoses."
    )

    st.divider()

    # -----------------------------------------------------
    # LIVE SIGNALS
    # -----------------------------------------------------

    st.subheader("🧠 Wellbeing Signals")

    signal_col1, signal_col2, signal_col3 = st.columns(3)

    with signal_col1:

        st.metric(
            "📏 Distance Alerts",
            distance_alerts,
        )

    with signal_col2:

        st.metric(
            "👀 Looking Away",
            looking_away_alerts,
        )

    with signal_col3:

        st.metric(
            "😴 Fatigue Signals",
            fatigue_signals,
        )

    st.divider()

    # -----------------------------------------------------
    # ANALYTICS
    # -----------------------------------------------------

    st.subheader("📈 Session Analytics")

    if not history_df.empty:

        # FOCUS SCORE CHART

        if "focus_score" in history_df.columns:

            st.write("### Focus Score Over Time")

            if "minute" in history_df.columns:

                focus_chart = history_df.set_index(
                    "minute"
                )[["focus_score"]]

            else:

                focus_chart = history_df[
                    ["focus_score"]
                ]

            st.line_chart(
                focus_chart,
                y="focus_score",
            )

        # ALERT CHART

        alert_columns = [
            "posture_alerts",
            "distance_alerts",
            "looking_away_alerts",
            "fatigue_signals",
        ]

        available_alert_columns = [
            column
            for column in alert_columns
            if column in history_df.columns
        ]

        if available_alert_columns:

            st.write("### Detected Events Over Time")

            if "minute" in history_df.columns:

                alert_chart = history_df.set_index(
                    "minute"
                )[available_alert_columns]

            else:

                alert_chart = history_df[
                    available_alert_columns
                ]

            st.line_chart(
                alert_chart,
            )

    else:

        st.info(
            "Session history will appear here once data is available."
        )

    st.divider()

    # -----------------------------------------------------
    # TOTAL SIGNALS
    # -----------------------------------------------------

    st.subheader("🚨 Session Signals")

    st.metric(
        "Total Detected Signals",
        total_alerts,
    )

    if total_alerts == 0:

        st.success(
            "No wellbeing signals have been detected."
        )

    elif total_alerts <= 3:

        st.info(
            "A few signals have been detected. "
            "Keep an eye on your study habits."
        )

    else:

        st.warning(
            "Several signals have been detected. "
            "Consider taking a short break and adjusting your setup."
        )

    st.divider()

    # -----------------------------------------------------
    # MANUAL HABITS
    # -----------------------------------------------------

    st.header("💧 Manual Habit Logging")

    habit_col1, habit_col2, habit_col3 = st.columns(3)

    with habit_col1:

        water_glasses = st.number_input(
            "Glasses of water today",
            min_value=0,
            max_value=20,
            value=0,
            step=1,
        )

    with habit_col2:

        breaks_taken = st.number_input(
            "Breaks taken this session",
            min_value=0,
            max_value=20,
            value=0,
            step=1,
        )

    with habit_col3:

        sleep_hours = st.slider(
            "Hours of sleep last night",
            min_value=0.0,
            max_value=12.0,
            value=7.0,
            step=0.5,
        )

    st.write(
        f"💧 **{water_glasses}** glasses  |  "
        f"☕ **{breaks_taken}** breaks  |  "
        f"😴 **{sleep_hours}** hours of sleep"
    )


# =========================================================
# TAB 3 — REFLECTION & RESULTS
# =========================================================

with tab3:

    st.header("📝 Session Reflection")

    st.caption(
        "A summary of what FocusMate detected during the session."
    )

    # SUMMARY

    summary_col1, summary_col2 = st.columns(2)

    with summary_col1:

        st.metric(
            "Focus Score",
            f"{focus_score:.1f}/100",
        )

        st.metric(
            "Session Duration",
            f"{session_minutes:.2f} minutes",
        )

    with summary_col2:

        st.metric(
            "Posture Alerts",
            posture_alerts,
        )

        st.metric(
            "Total Signals",
            total_alerts,
        )

    st.divider()

    # SESSION RESULTS

    st.subheader("📋 Session Results")

    st.write(
        f"**Posture alerts:** {posture_alerts}"
    )

    st.write(
        f"**Distance alerts:** {distance_alerts}"
    )

    st.write(
        f"**Looking-away events:** {looking_away_alerts}"
    )

    st.write(
        f"**Fatigue-related signals:** {fatigue_signals}"
    )

    st.write(
        f"**Session duration:** {session_minutes:.2f} minutes"
    )

    st.divider()

    # FOCUSMATE FEEDBACK

    st.subheader("💡 FocusMate Feedback")

    if posture_alerts >= 4:

        st.warning(
            "You had several posture alerts. "
            "Try adjusting your sitting position and screen height."
        )

    else:

        st.success(
            "Your posture remained relatively stable "
            "during this session."
        )

    if distance_alerts >= 2:

        st.info(
            "There were several screen-distance alerts. "
            "Try maintaining a comfortable viewing distance."
        )

    if looking_away_alerts >= 3:

        st.info(
            "Several looking-away events were detected. "
            "A short planned break may help you reset your attention."
        )

    if fatigue_signals >= 2:

        st.info(
            "Several fatigue-related signals were detected. "
            "Consider taking a short break before continuing."
        )

    st.divider()

    # LIVE DETECTION SUMMARY

    st.subheader("📷 Webcam Detection Summary")

    webcam_col1, webcam_col2, webcam_col3 = st.columns(3)

    with webcam_col1:

        st.write(
            f"**Face detected:** "
            f"{'Yes ✅' if face_detected else 'No ⚠️'}"
        )

        st.write(
            f"**Posture:** {posture}"
        )

    with webcam_col2:

        st.write(
            f"**Distance:** {distance_status}"
        )

        st.write(
            f"**Looking away:** "
            f"{'Yes ⚠️' if looking_away else 'No ✅'}"
        )

    with webcam_col3:

        st.write(
            f"**Eyes closed signal:** "
            f"{'Yes ⚠️' if eyes_closed else 'No ✅'}"
        )

        st.write(
            f"**Detection status:** {status}"
        )

    st.divider()

    # HISTORY SUMMARY

    if not history_df.empty:

        st.subheader("📊 Session History")

        if "focus_score" in history_df.columns:

            average_focus = (
                history_df["focus_score"].mean()
            )

            highest_focus = (
                history_df["focus_score"].max()
            )

            lowest_focus = (
                history_df["focus_score"].min()
            )

            history_col1, history_col2, history_col3 = st.columns(3)

            with history_col1:

                st.metric(
                    "Average Focus",
                    f"{average_focus:.1f}/100",
                )

            with history_col2:

                st.metric(
                    "Highest Focus",
                    f"{highest_focus:.1f}/100",
                )

            with history_col3:

                st.metric(
                    "Lowest Focus",
                    f"{lowest_focus:.1f}/100",
                )

    st.divider()

    # COMPETITION IMPACT

    st.subheader("🏆 Wellbeing Impact")

    st.write(
        "FocusMate turns real study-session signals into "
        "understandable feedback so students can recognize "
        "patterns in their study habits."
    )

    st.write(
        "Instead of simply telling the student to focus, "
        "the system uses computer-vision data to show "
        "what happened during the session."
    )

    st.success(
        "📊 Observe → Understand → Improve"
    )

    st.divider()

    # FOOTER

    st.caption(
        "🔄 Dashboard automatically refreshes every 3 seconds."
    )

    st.caption(
        "📷 Webcam → integrated_detection.py → "
        "session_data.json → FocusMate Dashboard"
    )