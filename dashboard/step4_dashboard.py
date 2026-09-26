"""
FocusMate - Dashboard Module
STEP 4: Connect dashboard to session_data.json

The dashboard now reads session data from a JSON file instead of
using hardcoded placeholder values.
"""

import json
import streamlit as st

st.set_page_config(
    page_title="FocusMate",
    page_icon="🧠",
    layout="wide",
)


# ---------------------------------------------------------
# LOAD SESSION DATA
# ---------------------------------------------------------

def load_session_data():
    with open("session_data.json", "r") as file:
        return json.load(file)


data = load_session_data()


# ---------------------------------------------------------
# HEADER
# ---------------------------------------------------------

st.title("🧠 FocusMate")
st.caption(
    "An AI wellbeing dashboard for better study posture and screen habits."
)


# ---------------------------------------------------------
# THREE TABS
# ---------------------------------------------------------

tab1, tab2, tab3 = st.tabs(
    [
        "1️⃣ Introduce the Problem",
        "2️⃣ Live Challenge",
        "3️⃣ Reflection & Results",
    ]
)


# ---------------------------------------------------------
# TAB 1 — INTRODUCE THE PROBLEM
# ---------------------------------------------------------

with tab1:

    st.header("The Problem")

    st.write(
        "During a study session, students may not notice changes in "
        "posture, screen distance, or how often they look away."
    )

    st.write(
        "FocusMate monitors these signals during a study session and "
        "turns them into simple information that can help students "
        "understand their study habits."
    )

    if st.button("Start Session ▶️", type="primary"):
        st.info("Live webcam session will be connected here.")


# ---------------------------------------------------------
# TAB 2 — LIVE CHALLENGE
# ---------------------------------------------------------

with tab2:

    st.header("📊 Live Session Stats")

    st.caption(
        "These values are being read from session_data.json."
    )

    col1, col2, col3, col4 = st.columns(4)

    col1.metric(
        "Focus Score",
        f"{data['focus_score']}/100"
    )

    col2.metric(
        "Posture Alerts",
        data["posture_alerts"]
    )

    col3.metric(
        "Looking Away Events",
        data["looking_away_alerts"]
    )

    col4.metric(
        "Session Time",
        f"{data['session_minutes']} min"
    )

    st.divider()

    st.subheader("Additional Signals")

    signal_col1, signal_col2 = st.columns(2)

    with signal_col1:
        st.metric(
            "Distance Alerts",
            data["distance_alerts"]
        )

    with signal_col2:
        st.metric(
            "Fatigue Signals",
            data["fatigue_signals"]
        )

    st.divider()

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
        f"Logged so far: **{water_glasses} glasses of water**, "
        f"**{breaks_taken} breaks**, "
        f"**{sleep_hours} hours of sleep**."
    )


# ---------------------------------------------------------
# TAB 3 — REFLECTION & RESULTS
# ---------------------------------------------------------

with tab3:

    st.header("📝 Session Summary")

    st.caption(
        "This summary is generated from the session data."
    )

    st.info(
        f"""
Your current session:

- Focus score: **{data['focus_score']}%**
- Posture alerts: **{data['posture_alerts']}**
- Distance alerts: **{data['distance_alerts']}**
- Looking away events: **{data['looking_away_alerts']}**
- Fatigue-related signals: **{data['fatigue_signals']}**
- Session time: **{data['session_minutes']} minutes**
        """
    )

    st.subheader("💡 FocusMate Feedback")

    if data["posture_alerts"] >= 4:

        st.warning(
            "You had several posture alerts during this session. "
            "Try adjusting your sitting position and screen height."
        )

    else:

        st.success(
            "Your posture remained relatively stable during this session."
        )

    if data["distance_alerts"] >= 2:

        st.info(
            "There were several distance alerts. "
            "Consider keeping a comfortable distance from the screen."
        )

    if data["looking_away_alerts"] >= 3:

        st.info(
            "There were several looking-away events. "
            "A short planned break may help you reset your attention."
        )