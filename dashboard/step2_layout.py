"""
FocusMate - Dashboard Module
STEP 2: Page layout (with placeholder/dummy data)

Goal of this stage:
    Build the actual visual structure of the FocusMate dashboard:
      1. Header
      2. Live Session Stats section  (will later come from the webcam module)
      3. Manual Habit Logging section (water, breaks, sleep - typed in by hand)
      4. Session Summary section      (will later show at the end of a session)

    All the numbers here are FAKE / placeholder for now. We are only
    building the layout. Real data gets wired in from Step 4 onwards.

Run with (PowerShell):
    streamlit run step2_layout.py
"""

import streamlit as st

st.set_page_config(
    page_title="FocusMate",
    page_icon="🧠",
    layout="wide",  # "wide" gives us more horizontal room for columns
)

# ---------------------------------------------------------------------------
# 1. HEADER
# ---------------------------------------------------------------------------
st.title("🧠 FocusMate")
st.caption("An AI wellbeing dashboard for better study posture and screen habits.")

st.divider()

# ---------------------------------------------------------------------------
# 2. LIVE SESSION STATS (placeholder data for now)
# ---------------------------------------------------------------------------
st.header("📊 Live Session Stats")
st.caption(
    "These numbers will update in real time once connected to the webcam "
    "detection module. Right now they are placeholder values."
)

# st.columns lets us lay out several metric boxes side by side.
col1, col2, col3, col4 = st.columns(4)

# Placeholder / fake values - these will be replaced with real numbers later.
placeholder_focus_score = 82
placeholder_posture_alerts = 4
placeholder_looking_away = 2
placeholder_session_minutes = 18

col1.metric("Focus Score", f"{placeholder_focus_score}/100")
col2.metric("Posture Alerts", placeholder_posture_alerts)
col3.metric("Looking Away Events", placeholder_looking_away)
col4.metric("Session Time", f"{placeholder_session_minutes} min")

st.divider()

# ---------------------------------------------------------------------------
# 3. MANUAL HABIT LOGGING
# ---------------------------------------------------------------------------
st.header("💧 Manual Habit Logging")
st.caption("Log habits by hand that the webcam can't detect on its own.")

habit_col1, habit_col2, habit_col3 = st.columns(3)

with habit_col1:
    water_glasses = st.number_input(
        "Glasses of water today", min_value=0, max_value=20, value=0, step=1
    )

with habit_col2:
    breaks_taken = st.number_input(
        "Breaks taken this session", min_value=0, max_value=20, value=0, step=1
    )

with habit_col3:
    sleep_hours = st.slider(
        "Hours of sleep last night", min_value=0.0, max_value=12.0, value=7.0, step=0.5
    )

st.write(
    f"Logged so far: **{water_glasses} glasses of water**, "
    f"**{breaks_taken} breaks**, **{sleep_hours} hours of sleep**."
)

st.divider()

# ---------------------------------------------------------------------------
# 4. SESSION SUMMARY (placeholder - this becomes the "Stage 3: Reflection" screen)
# ---------------------------------------------------------------------------
st.header("📝 Session Summary")
st.caption("This section will appear at the end of a study session (Stage 3 of the demo).")

st.info(
    "Example placeholder summary:\n\n"
    "Your 25-minute session\n"
    "- Posture alerts: 7\n"
    "- Long distractions: 3\n"
    "- Breaks taken: 1\n"
    "- Focus score: 78%\n\n"
    "*(This will be generated automatically from real session data in a later step.)*"
)
