import { localDateKey } from './progress-data.js';
import { isDetectionSignalMonitored } from './session-detection.js';

export const achievementCatalog = [
  [
    "first_step",
    "First Step",
    "Complete your first study session.",
    15,
    "Sessions & focus",
  ],
  [
    "locked_in",
    "Camera Ready",
    "Complete an optional camera session.",
    20,
    "Sessions & focus",
  ],
  [
    "time_keeper",
    "Time Keeper",
    "Complete a 15-minute session.",
    15,
    "Sessions & focus",
  ],
  [
    "half_hour_hero",
    "Half Hour Hero",
    "Complete a 30-minute session.",
    20,
    "Sessions & focus",
  ],
  [
    "hour_of_focus",
    "Hour of Focus",
    "Complete a 60-minute session.",
    30,
    "Sessions & focus",
  ],
  [
    "getting_started",
    "Getting Started",
    "Complete 3 sessions.",
    20,
    "Sessions & focus",
  ],
  [
    "focused_mind",
    "Focused Mind",
    "Complete 5 sessions.",
    25,
    "Sessions & focus",
  ],
  [
    "consistency",
    "Consistency",
    "Complete 10 sessions.",
    35,
    "Sessions & focus",
  ],
  [
    "dedicated_student",
    "Dedicated Student",
    "Complete 25 sessions.",
    50,
    "Sessions & focus",
  ],
  [
    "focus_master",
    "Focus Master",
    "Complete 50 sessions.",
    100,
    "Sessions & focus",
  ],
  [
    "two_day_streak",
    "2-Day Streak",
    "Study on 2 consecutive days.",
    15,
    "Streaks & routines",
  ],
  [
    "three_day_streak",
    "3-Day Streak",
    "Study on 3 consecutive days.",
    20,
    "Streaks & routines",
  ],
  [
    "seven_day_streak",
    "7-Day Streak",
    "Study on 7 consecutive days.",
    40,
    "Streaks & routines",
  ],
  [
    "fourteen_day_streak",
    "14-Day Streak",
    "Study on 14 consecutive days.",
    75,
    "Streaks & routines",
  ],
  [
    "thirty_day_streak",
    "30-Day Streak",
    "Study on 30 consecutive days.",
    150,
    "Streaks & routines",
  ],
  [
    "posture_pro",
    "Posture Pro",
    "Complete a session with no posture alerts.",
    20,
    "Study habits",
  ],
  [
    "sit_smart",
    "Sit Smart",
    "Complete 3 sessions with no posture alerts.",
    30,
    "Study habits",
  ],
  [
    "perfect_distance",
    "Perfect Distance",
    "Complete a session with no distance alerts.",
    20,
    "Study habits",
  ],
  [
    "eyes_forward",
    "Eyes Forward",
    "Complete a session with no head-turn alerts.",
    20,
    "Study habits",
  ],
  [
    "steady_session",
    "Steady Session",
    "Complete a session with no posture or distance alerts.",
    35,
    "Study habits",
  ],
  [
    "clean_session",
    "Clean Session",
    "Complete a session with no recorded alerts.",
    50,
    "Study habits",
  ],
  [
    "sharp_start",
    "Goal Start",
    "Complete your first camera session with a written goal.",
    30,
    "Sessions & focus",
  ],
  [
    "level_up",
    "Separate Days",
    "Complete sessions on two different days.",
    20,
    "Sessions & focus",
  ],
  [
    "personal_best",
    "Longer Session",
    "Complete a session longer than your previous one.",
    25,
    "Sessions & focus",
  ],
  [
    "ninety_club",
    "90-Minute Club",
    "Complete a 90-minute session.",
    20,
    "Sessions & focus",
  ],
  [
    "perfect_estimate",
    "Two-Hour Block",
    "Complete a 120-minute session.",
    50,
    "Sessions & focus",
  ],
  [
    "comeback",
    "Return Routine",
    "Study again after at least one full day away.",
    20,
    "Sessions & focus",
  ],
  [
    "getting_better",
    "Goal Check-ins",
    "Record goal outcomes for three sessions.",
    40,
    "Sessions & focus",
  ],
  [
    "focused_week",
    "Focused Week",
    "Complete 5 sessions in one calendar week.",
    35,
    "Streaks & routines",
  ],
  [
    "study_routine",
    "Study Routine",
    "Complete 10 sessions across multiple study days.",
    50,
    "Streaks & routines",
  ],
  [
    "persistence",
    "Persistence",
    "Accumulate 2 hours of study time.",
    15,
    "Study time & XP",
  ],
  [
    "time_builder",
    "Time Builder",
    "Accumulate 5 hours of study time.",
    25,
    "Study time & XP",
  ],
  [
    "study_veteran",
    "Study Veteran",
    "Accumulate 10 hours of study time.",
    50,
    "Study time & XP",
  ],
  [
    "twenty_hour_club",
    "20-Hour Club",
    "Accumulate 20 hours of study time.",
    75,
    "Study time & XP",
  ],
  [
    "fifty_hour_club",
    "50-Hour Club",
    "Accumulate 50 hours of study time.",
    150,
    "Study time & XP",
  ],
  [
    "quick_focus",
    "Quick Block",
    "Complete a 10-minute camera session.",
    20,
    "Sessions & focus",
  ],
  [
    "long_haul",
    "Long Haul",
    "Complete a 45-minute session.",
    30,
    "Sessions & focus",
  ],
  [
    "keep_going",
    "Keep Going",
    "Complete 5 study sessions.",
    30,
    "Sessions & focus",
  ],
  ["no_quit", "No Quit", "Complete 3 study sessions.", 20, "Sessions & focus"],
  [
    "early_focus",
    "Early Focus",
    "Complete a session before noon.",
    15,
    "Streaks & routines",
  ],
  [
    "evening_focus",
    "Evening Focus",
    "Complete a session after 6 PM.",
    15,
    "Streaks & routines",
  ],
  [
    "routine_builder",
    "Routine Builder",
    "Study on 7 different days.",
    30,
    "Streaks & routines",
  ],
  ["xp_collector", "XP Collector", "Earn 500 XP.", 25, "Study time & XP"],
  ["xp_hunter", "XP Hunter", "Earn 1,000 XP.", 50, "Study time & XP"],
  ["xp_champion", "XP Champion", "Earn 5,000 XP.", 100, "Study time & XP"],
  [
    "explorer",
    "Explorer",
    "Complete a session with a new study goal.",
    15,
    "Goals & reflection",
  ],
  [
    "goal_getter",
    "Goal Getter",
    "Complete a session linked to a study goal.",
    15,
    "Goals & reflection",
  ],
  [
    "self_aware",
    "Self-Aware",
    "View a session reflection.",
    10,
    "Goals & reflection",
  ],
  [
    "reflection_reader",
    "Reflection Reader",
    "Read your first session reflection.",
    15,
    "Goals & reflection",
  ],
  [
    "focusmate_legend",
    "FocusMate Legend",
    "Unlock 20 other achievements.",
    250,
    "Goals & reflection",
  ],
];

function sessionDays(profile) {
  return [
    ...new Set(
      [...profile.session_history, ...(profile.focus_timer_history || [])]
        .filter((item) => Number(item.seconds) > 0)
        .map((item) => String(item.date || "").slice(0, 10))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    ),
  ]
    .sort()
    .reverse();
}

function consecutiveStudyDays(days) {
  if (!days.length) return 0;
  const latest = days[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (latest !== localDateKey() && latest !== localDateKey(yesterday)) return 0;
  let streak = 0;
  let cursor = new Date(`${latest}T12:00:00`);
  const daySet = new Set(days);
  while (daySet.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function sessionsThisWeek(sessions) {
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  return sessions.filter(
    (item) =>
      new Date(`${String(item.date).slice(0, 10)}T12:00:00`) >= weekStart,
  ).length;
}

function isEligible(id, profile, context) {
  const live = context.live || {};
  const sessions = profile.session_history;
  const current = sessions.at(-1) || {};
  const previous = sessions.at(-2);
  const seconds = Number(current.seconds || 0);
  const days = sessionDays(profile);
  const totalSeconds =
    Number(profile.total_study_seconds || 0) +
    Number(profile.focus_timer_total_seconds || 0);
  const startHour = new Date(
    live.session_started_at || current.session_started_at || Date.now(),
  ).getHours();
  switch (id) {
    case "first_step":
      return context.type === "session" && sessions.length >= 1;
    case "locked_in":
      return context.type === "session" && seconds > 0;
    case "time_keeper":
      return context.type === "session" && seconds >= 900;
    case "half_hour_hero":
      return context.type === "session" && seconds >= 1800;
    case "hour_of_focus":
      return context.type === "session" && seconds >= 3600;
    case "ninety_club":
      return context.type === "session" && seconds >= 5400;
    case "perfect_estimate":
      return context.type === "session" && seconds >= 7200;
    case "getting_started":
      return context.type === "session" && sessions.length >= 3;
    case "focused_mind":
      return context.type === "session" && sessions.length >= 5;
    case "consistency":
      return context.type === "session" && sessions.length >= 10;
    case "dedicated_student":
      return context.type === "session" && sessions.length >= 25;
    case "focus_master":
      return context.type === "session" && sessions.length >= 50;
    case "two_day_streak":
      return context.type === "session" && consecutiveStudyDays(days) >= 2;
    case "three_day_streak":
      return context.type === "session" && consecutiveStudyDays(days) >= 3;
    case "seven_day_streak":
      return context.type === "session" && consecutiveStudyDays(days) >= 7;
    case "fourteen_day_streak":
      return context.type === "session" && consecutiveStudyDays(days) >= 14;
    case "thirty_day_streak":
      return context.type === "session" && consecutiveStudyDays(days) >= 30;
    case "posture_pro":
      return (
        context.type === "session" &&
        isDetectionSignalMonitored(current, "slouching") &&
        current.pose_detected &&
        !current.posture_alerts
      );
    case "sit_smart":
      return (
        context.type === "session" &&
        sessions.filter((item) => isDetectionSignalMonitored(item, "slouching") && item.pose_detected && !item.posture_alerts)
          .length >= 3
      );
    case "perfect_distance":
      return (
        context.type === "session" &&
        isDetectionSignalMonitored(current, "distance_alert") &&
        current.face_detected &&
        !current.distance_alerts
      );
    case "eyes_forward":
      return (
        context.type === "session" &&
        isDetectionSignalMonitored(current, "looking_away") &&
        current.face_detected &&
        !current.looking_away_alerts
      );
    case "steady_session":
      return (
        context.type === "session" &&
        isDetectionSignalMonitored(current, "slouching") &&
        isDetectionSignalMonitored(current, "distance_alert") &&
        current.pose_detected &&
        current.face_detected &&
        !current.posture_alerts &&
        !current.distance_alerts
      );
    case "clean_session":
      return (
        context.type === "session" &&
        isDetectionSignalMonitored(current, "slouching") &&
        isDetectionSignalMonitored(current, "distance_alert") &&
        isDetectionSignalMonitored(current, "looking_away") &&
        isDetectionSignalMonitored(current, "eyes_closed") &&
        isDetectionSignalMonitored(current, "face_missing") &&
        current.pose_detected &&
        current.face_detected &&
        !current.posture_alerts &&
        !current.distance_alerts &&
        !current.looking_away_alerts &&
        !current.fatigue_signals &&
        !current.face_missing_alerts
      );
    case "sharp_start":
      return (
        context.type === "session" &&
        sessions.length === 1 &&
        Boolean(current.goal)
      );
    case "level_up":
      return (
        context.type === "session" && sessions.length >= 2 && days.length >= 2
      );
    case "personal_best":
      return (
        context.type === "session" &&
        previous &&
        seconds > Number(previous.seconds || 0)
      );
    case "comeback":
      return (
        context.type === "session" &&
        previous &&
        (new Date(`${current.date}T00:00:00Z`) -
          new Date(`${previous.date}T00:00:00Z`)) /
          86_400_000 >=
          2
      );
    case "getting_better":
      return (
        context.type === "session" &&
        sessions.filter((item) => item.goal_outcome).length >= 3
      );
    case "focused_week":
      return context.type === "session" && sessionsThisWeek(sessions) >= 5;
    case "study_routine":
      return (
        context.type === "session" && sessions.length >= 10 && days.length >= 2
      );
    case "persistence":
      return (
        ["session", "study_time"].includes(context.type) && totalSeconds >= 7200
      );
    case "time_builder":
      return (
        ["session", "study_time"].includes(context.type) &&
        totalSeconds >= 18_000
      );
    case "study_veteran":
      return (
        ["session", "study_time"].includes(context.type) &&
        totalSeconds >= 36_000
      );
    case "twenty_hour_club":
      return (
        ["session", "study_time"].includes(context.type) &&
        totalSeconds >= 72_000
      );
    case "fifty_hour_club":
      return (
        ["session", "study_time"].includes(context.type) &&
        totalSeconds >= 180_000
      );
    case "quick_focus":
      return context.type === "session" && seconds >= 600;
    case "long_haul":
      return context.type === "session" && seconds >= 2700;
    case "keep_going":
      return context.type === "session" && sessions.length >= 5;
    case "no_quit":
      return context.type === "session" && sessions.length >= 3;
    case "early_focus":
      return context.type === "session" && startHour < 12;
    case "evening_focus":
      return context.type === "session" && startHour >= 18;
    case "routine_builder":
      return context.type === "session" && days.length >= 7;
    case "xp_collector":
      return profile.total_xp >= 500;
    case "xp_hunter":
      return profile.total_xp >= 1000;
    case "xp_champion":
      return profile.total_xp >= 5000;
    case "explorer":
      return (
        context.type === "session" &&
        Boolean(current.goal) &&
        !sessions.slice(0, -1).some((item) => item.goal === current.goal)
      );
    case "goal_getter":
      return context.type === "session" && Boolean(current.goal);
    case "self_aware":
      return context.type === "reflection";
    case "reflection_reader":
      return (
        context.type === "reflection" && profile.session_reflections.length > 0
      );
    case "focusmate_legend":
      return profile.achievements.filter((item) => item.id !== id).length >= 20;
    default:
      return false;
  }
}

export function awardEligibleAchievements(profile, context) {
  const added = [];
  let hasNewAwards = true;
  while (hasNewAwards) {
    hasNewAwards = false;
    for (const [id, title, description, xp] of achievementCatalog) {
      if (
        profile.achievements.some((item) =>
          typeof item === 'string' ? item === id : item?.id === id,
        ) ||
        !isEligible(id, profile, context)
      )
        continue;
      const record = {
        id,
        title,
        description,
        xp,
        earned_at: new Date().toISOString(),
      };
      profile.achievements.push(record);
      profile.total_xp = Number(profile.total_xp || 0) + xp;
      added.push(record);
      hasNewAwards = true;
    }
  }
  return added;
}

export function achievementProgress(profile, id) {
  const sessions = Array.isArray(profile.session_history)
    ? profile.session_history.filter((item) => item && Number(item.seconds) > 0)
    : [];
  const days = sessionDays({
    session_history: sessions,
    focus_timer_history: Array.isArray(profile.focus_timer_history) ? profile.focus_timer_history : [],
  });
  const totalMinutes = Math.floor(
    (Number(profile.total_study_seconds || 0) + Number(profile.focus_timer_total_seconds || 0)) / 60,
  );
  const longestSessionMinutes = Math.floor(
    sessions.reduce((longest, item) => Math.max(longest, Number(item.seconds) || 0), 0) / 60,
  );
  const noPostureAlerts = sessions.filter((item) => isDetectionSignalMonitored(item, "slouching") && item.pose_detected && Number(item.posture_alerts) === 0).length;
  const noDistanceAlerts = sessions.filter((item) => isDetectionSignalMonitored(item, "distance_alert") && item.face_detected && Number(item.distance_alerts) === 0).length;
  const noLookingAwayAlerts = sessions.filter((item) => isDetectionSignalMonitored(item, "looking_away") && item.face_detected && Number(item.looking_away_alerts) === 0).length;
  const cleanSessions = sessions.filter((item) =>
    isDetectionSignalMonitored(item, "slouching")
    && isDetectionSignalMonitored(item, "distance_alert")
    && isDetectionSignalMonitored(item, "looking_away")
    && isDetectionSignalMonitored(item, "eyes_closed")
    && isDetectionSignalMonitored(item, "face_missing")
    && item.pose_detected
    && item.face_detected
    && Number(item.posture_alerts) === 0
    && Number(item.distance_alerts) === 0
    && Number(item.looking_away_alerts) === 0
    && Number(item.fatigue_signals) === 0
    && Number(item.face_missing_alerts || 0) === 0,
  ).length;
  const goalSessions = sessions.filter((item) => Boolean(item.goal)).length;
  const uniqueGoals = new Set(sessions.map((item) => item.goal).filter(Boolean)).size;
  const reflectionCount = Array.isArray(profile.session_reflections) ? profile.session_reflections.length : 0;
  const records = {
    first_step: [sessions.length, 1, 'sessions'],
    locked_in: [sessions.length, 1, 'camera sessions'],
    time_keeper: [longestSessionMinutes, 15, 'min in one session'],
    half_hour_hero: [longestSessionMinutes, 30, 'min in one session'],
    hour_of_focus: [longestSessionMinutes, 60, 'min in one session'],
    ninety_club: [longestSessionMinutes, 90, 'min in one session'],
    perfect_estimate: [longestSessionMinutes, 120, 'min in one session'],
    getting_started: [sessions.length, 3, 'sessions'],
    focused_mind: [sessions.length, 5, 'sessions'],
    consistency: [sessions.length, 10, 'sessions'],
    dedicated_student: [sessions.length, 25, 'sessions'],
    focus_master: [sessions.length, 50, 'sessions'],
    two_day_streak: [consecutiveStudyDays(days), 2, 'consecutive days'],
    three_day_streak: [consecutiveStudyDays(days), 3, 'consecutive days'],
    seven_day_streak: [consecutiveStudyDays(days), 7, 'consecutive days'],
    fourteen_day_streak: [consecutiveStudyDays(days), 14, 'consecutive days'],
    thirty_day_streak: [consecutiveStudyDays(days), 30, 'consecutive days'],
    posture_pro: [noPostureAlerts, 1, 'sessions without posture alerts'],
    sit_smart: [noPostureAlerts, 3, 'sessions without posture alerts'],
    perfect_distance: [noDistanceAlerts, 1, 'sessions without distance alerts'],
    eyes_forward: [noLookingAwayAlerts, 1, 'sessions without head-turn alerts'],
    steady_session: [sessions.filter((item) => isDetectionSignalMonitored(item, "slouching") && isDetectionSignalMonitored(item, "distance_alert") && item.pose_detected && item.face_detected && !Number(item.posture_alerts) && !Number(item.distance_alerts)).length, 1, 'sessions'],
    clean_session: [cleanSessions, 1, 'sessions without recorded alerts'],
    sharp_start: [sessions.length === 1 && goalSessions ? 1 : 0, 1, 'first session with a goal'],
    level_up: [days.length, 2, 'study days'],
    getting_better: [sessions.filter((item) => item.goal_outcome).length, 3, 'goal check-ins'],
    focused_week: [sessionsThisWeek(sessions), 5, 'sessions this week'],
    study_routine: [Math.min(sessions.length, 10), 10, 'sessions'],
    persistence: [totalMinutes, 120, 'study min'],
    time_builder: [totalMinutes, 300, 'study min'],
    study_veteran: [totalMinutes, 600, 'study min'],
    twenty_hour_club: [totalMinutes, 1200, 'study min'],
    fifty_hour_club: [totalMinutes, 3000, 'study min'],
    quick_focus: [longestSessionMinutes, 10, 'min in one session'],
    long_haul: [longestSessionMinutes, 45, 'min in one session'],
    keep_going: [sessions.length, 5, 'sessions'],
    no_quit: [sessions.length, 3, 'sessions'],
    routine_builder: [days.length, 7, 'study days'],
    xp_collector: [Number(profile.total_xp || 0), 500, 'XP'],
    xp_hunter: [Number(profile.total_xp || 0), 1000, 'XP'],
    xp_champion: [Number(profile.total_xp || 0), 5000, 'XP'],
    explorer: [uniqueGoals, 1, 'unique study goals'],
    goal_getter: [goalSessions, 1, 'sessions with a goal'],
    self_aware: [reflectionCount, 1, 'reflections'],
    reflection_reader: [reflectionCount, 1, 'reflections'],
    focusmate_legend: [profile.achievements.length, 20, 'achievements'],
  };
  const record = records[id];
  if (!record) return null;
  const [value, target, unit] = record;
  return {
    current: Math.min(target, Math.max(0, Number(value) || 0)),
    target,
    unit,
  };
}
