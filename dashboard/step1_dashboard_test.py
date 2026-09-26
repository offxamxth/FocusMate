"""
FocusMate - Dashboard Module
STEP 1: Basic Streamlit test

Goal of this stage:
    Prove that Streamlit is installed correctly and that you can launch
    a web app from Python. Nothing about FocusMate yet - just confirming
    the tool works.

Streamlit apps are NOT run with "python file.py" - they use a special
command: "streamlit run file.py". This opens your default web browser
automatically at a local address like http://localhost:8501

Run with (PowerShell):
    streamlit run step1_dashboard_test.py
"""

import streamlit as st

# st.set_page_config must be the FIRST Streamlit command in the script.
# It sets the browser tab title and icon.
st.set_page_config(
    page_title="FocusMate",
    page_icon="🧠",
    layout="centered",
)

# --- Basic page content ---
st.title("🧠 FocusMate")
st.subheader("Dashboard Module - Step 1 Test")

st.write(
    "If you can see this page in your browser, Streamlit is installed "
    "correctly and your dashboard module is ready to build."
)

# A simple interactive element, just to confirm interactivity works too.
name = st.text_input("Type your name to test interactivity:")

if name:
    st.success(f"Hi {name}! Streamlit is working correctly. ✅")
else:
    st.info("Type something in the box above to test that the app responds.")
