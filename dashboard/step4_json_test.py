import json

with open("session_data.json", "r") as file:
    data = json.load(file)

print("Focus Score:", data["focus_score"])
print("Posture Alerts:", data["posture_alerts"])
print("Distance Alerts:", data["distance_alerts"])
print("Looking Away Alerts:", data["looking_away_alerts"])
print("Fatigue Signals:", data["fatigue_signals"])
print("Session Minutes:", data["session_minutes"])