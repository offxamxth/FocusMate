"""
FocusMate - Dashboard Module
STEP 6: Professional / Competition-Ready Dashboard

Uses:
    - session_data.json
    - Automatic refresh every 3 seconds
    - Streamlit

This step focuses on presentation and visualization.
The webcam module is NOT connected yet.
"""

import json
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
# LOAD SESSION DATA
# =========================================================

def load_session_data():
    with open("session_data.json", "r") as file:
        return json.load(file)


data = load_session_data()


# =========================================================
# GET VALUES
# =========================================================

focus_score = data["focus_score"]
posture_alerts = data["posture_alerts"]
distance_alerts = data["distance_alerts"]
looking_away_alerts = data["looking_away_alerts"]
fatigue_signals = data["fatigue_signals"]
session_minutes = data["session_minutes"]
session_active = data["session_active"]


# =========================================================
# FOCUS SCORE STATUS
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
# HEADER
# =========================================================

st.title("🧠 FocusMate")

st.caption(
    "AI-powered wellbeing support for healthier study sessions."
)

# Session status at the top

if session_active:
    st.success("🟢 Study Session Active")
else:
    st.info("⚪ No Active Study Session")


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
            "FocusMate turns the session results into simple "
            "personalized wellbeing suggestions."
        )

    st.divider()

    if st.button(
        "Start Session ▶️",
        type="primary",
        use_container_width=True,
    ):

        st.info(
            "The live webcam module will be connected here."
        )


# =========================================================
# TAB 2 — LIVE CHALLENGE
# =========================================================

with tab2:

    st.header("📊 Live Session Dashboard")

    st.caption(
        "Data updates automatically every 3 seconds."
    )

    # -----------------------------------------------------
    # MAIN METRICS
    # -----------------------------------------------------

    col1, col2, col3, col4 = st.columns(4)

    with col1:

        st.metric(
            "Focus Score",
            f"{focus_score}/100",
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
            f"{session_minutes} min",
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
        f"Current focus score: **{focus_score}/100**"
    )

    st.divider()

    # -----------------------------------------------------
    # WELLBEING SIGNALS
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
    # ALERT SUMMARY
    # -----------------------------------------------------

    st.subheader("🚨 Session Alerts")

    total_alerts = (
        posture_alerts
        + distance_alerts
        + looking_away_alerts
        + fatigue_signals
    )

    st.metric(
        "Total Detected Signals",
        total_alerts,
    )

    if total_alerts == 0:

        st.success(
            "Great! No wellbeing alerts have been detected."
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

    # -----------------------------------------------------
    # SUMMARY
    # -----------------------------------------------------

    summary_col1, summary_col2 = st.columns(2)

    with summary_col1:

        st.metric(
            "Focus Score",
            f"{focus_score}/100",
        )

        st.metric(
            "Session Duration",
            f"{session_minutes} minutes",
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

    # -----------------------------------------------------
    # SESSION RESULTS
    # -----------------------------------------------------

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
        f"**Session duration:** {session_minutes} minutes"
    )

    st.divider()

    # -----------------------------------------------------
    # FOCUSMATE FEEDBACK
    # -----------------------------------------------------

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

    st.caption(
        "🔄 Data refreshes automatically every 3 seconds."
    )