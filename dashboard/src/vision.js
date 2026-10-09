import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import { normalizeDetectionConfiguration, visionTasksForConfiguration } from "./session-detection.js";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const HEAD_TURN_THRESHOLD = 0.24;
const SHOULDER_DETECT_FRAMES = 2;
const SHOULDER_LOSS_FRAMES = 5;
const SHOULDER_TILT_ACTIVATE_DEGREES = 17;
const SHOULDER_TILT_CLEAR_DEGREES = 12;
const SLOUCH_ANGLE_DEGREES = 52;
const postureSignals = new WeakMap();

export async function createVisionLandmarkers(configuration) {
  const tasks = visionTasksForConfiguration(configuration);
  if (!tasks.face && !tasks.pose) return { face: null, pose: null };
  const files = await FilesetResolver.forVisionTasks(WASM_URL);
  const face = tasks.face
    ? await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task" },
        runningMode: "VIDEO",
        numFaces: 1,
      })
    : null;
  try {
    const pose = tasks.pose
      ? await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker.task" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        })
      : null;
    return { face, pose };
  } catch (error) {
    face?.close();
    throw error;
  }
}

function landmarkDistance(first, second, width = 1, height = 1) {
  return Math.hypot(
    (first.x - second.x) * width,
    (first.y - second.y) * height,
  );
}

function eyeAspectRatio(landmarks, indices, width, height) {
  const [first, upperA, upperB, outer, lowerB, lowerA] = indices.map(
    (index) => landmarks[index],
  );
  const horizontal = landmarkDistance(first, outer, width, height);
  if (!horizontal) return 0;
  return (
    (landmarkDistance(upperA, lowerA, width, height) +
      landmarkDistance(upperB, lowerB, width, height)) /
    (2 * horizontal)
  );
}

function visible(point, threshold = 0.25) {
  const confidence = Number.isFinite(point?.visibility)
    ? point.visibility
    : point?.presence;
  return Boolean(
    point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= 1 &&
      point.y >= 0 &&
      point.y <= 1 &&
      (!Number.isFinite(confidence) || confidence >= threshold),
  );
}

function stableShoulderAvailability(state, currentlyVisible) {
  const availability = state.shoulderAvailability || {
    status: "checking",
    detectedFrames: 0,
    missingFrames: 0,
  };

  if (currentlyVisible) {
    availability.detectedFrames += 1;
    availability.missingFrames = 0;
    if (availability.detectedFrames >= SHOULDER_DETECT_FRAMES) {
      availability.status = "detected";
    }
  } else {
    availability.missingFrames += 1;
    availability.detectedFrames = 0;
    if (availability.missingFrames >= SHOULDER_LOSS_FRAMES) {
      availability.status = "missing";
    }
  }

  state.shoulderAvailability = availability;
  return availability;
}

function stableSignal(state, name, active, frames = 2) {
  const signal = state[name] || { active: false, onFrames: 0, offFrames: 0 };
  if (active) {
    signal.onFrames += 1;
    signal.offFrames = 0;
    if (signal.onFrames >= frames) signal.active = true;
  } else {
    signal.offFrames += 1;
    signal.onFrames = 0;
    if (signal.offFrames >= frames) signal.active = false;
  }
  state[name] = signal;
  return signal.active;
}

export function estimateHeadTurn(landmarks) {
  return headTurnRatio(landmarks) > HEAD_TURN_THRESHOLD;
}

function headTurnRatio(landmarks) {
  const nose = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const leftSpan = Math.abs(nose.x - leftCheek.x);
  const rightSpan = Math.abs(rightCheek.x - nose.x);
  const total = leftSpan + rightSpan;
  return total > 0 ? Math.abs(leftSpan - rightSpan) / total : 0;
}

export function detectMetrics(detectors, video, timestamp, configuration = {}) {
  const settings = normalizeDetectionConfiguration(configuration);
  const width = video.videoWidth;
  const height = video.videoHeight;
  const needsFace = settings.monitor_looking_away || settings.monitor_eye_closure
    || settings.monitor_face_missing || settings.monitor_distance
    || settings.show_detection_overlay;
  const faceResult = needsFace ? detectors.face?.detectForVideo(video, timestamp) : null;
  const face = faceResult?.faceLandmarks?.[0];
  const faceDetected = Boolean(face);
  const turnRatio = settings.monitor_looking_away && faceDetected ? headTurnRatio(face) : null;
  const lookingAway = turnRatio !== null && turnRatio > HEAD_TURN_THRESHOLD;
  const ear = settings.monitor_eye_closure && faceDetected
    ? (eyeAspectRatio(face, LEFT_EYE, width, height) +
        eyeAspectRatio(face, RIGHT_EYE, width, height)) /
      2
    : null;
  const eyesClosed = ear !== null && ear < 0.2;

  const poseResult = settings.monitor_posture
    ? detectors.pose?.detectForVideo(video, timestamp)
    : null;
  const pose = poseResult?.landmarks?.[0];
  const leftShoulder = pose?.[11];
  const rightShoulder = pose?.[12];
  const shouldersVisible = visible(leftShoulder) && visible(rightShoulder);
  let shoulderTilt = null;
  if (shouldersVisible) {
    const horizontal = Math.abs(leftShoulder.x - rightShoulder.x) * width;
    const vertical = Math.abs(leftShoulder.y - rightShoulder.y) * height;
    if (horizontal >= width * 0.08) {
      shoulderTilt = (Math.atan2(vertical, horizontal) * 180) / Math.PI;
    }
  }

  let posture = settings.monitor_posture ? "Unknown" : "Not monitored";
  let postureAngle = null;
  const shoulderEarPairs = settings.monitor_posture && shouldersVisible
    ? [[7, 11], [8, 12]].filter(([ear]) => visible(pose?.[ear]))
    : [];
  let postureState = postureSignals.get(detectors);
  if (!postureState) {
    postureState = {};
    postureSignals.set(detectors, postureState);
  }
  const shoulderAvailability = settings.monitor_posture
    ? stableShoulderAvailability(postureState, shouldersVisible)
    : { status: "not-monitored" };
  const poseDetected = shoulderAvailability.status === "detected";
  const poseDetectionStatus = poseDetected && !shouldersVisible
    ? "temporarily-missing"
    : shoulderAvailability.status;
  const shoulderMisaligned = settings.monitor_posture && shouldersVisible && shoulderTilt !== null &&
    shoulderTilt > (postureState.shoulderTilt?.active ? SHOULDER_TILT_CLEAR_DEGREES : SHOULDER_TILT_ACTIVATE_DEGREES);
  const stableShoulderMisalignment = !settings.monitor_posture
    ? false
    : shouldersVisible && shoulderTilt !== null
      ? stableSignal(postureState, "shoulderTilt", shoulderMisaligned)
      : Boolean(postureState.shoulderTilt?.active);
  if (shoulderEarPairs.length === 2) {
    const angles = shoulderEarPairs.map(
      ([ear, shoulder]) =>
        (Math.atan2(
          Math.abs(pose[ear].y - pose[shoulder].y) * height,
          Math.abs(pose[ear].x - pose[shoulder].x) * width,
        ) *
          180) /
        Math.PI,
    );
    postureAngle =
      angles.reduce((total, angle) => total + angle, 0) / angles.length;
    const likelySlouching = angles.every((angle) => angle < SLOUCH_ANGLE_DEGREES);
    posture = stableSignal(postureState, "slouching", likelySlouching)
      ? "Slouching"
      : "Good";
    postureState.lastPosture = posture;
    postureState.lastPostureAngle = postureAngle;
  } else {
    stableSignal(postureState, "slouching", false);
    if (!shouldersVisible && poseDetected && postureState.lastPosture) {
      posture = postureState.lastPosture;
      postureAngle = postureState.lastPostureAngle;
    }
  }

  let distanceStatus = settings.monitor_distance ? "Unknown" : "Not monitored";
  const distanceRatio = settings.monitor_distance && faceDetected
    ? landmarkDistance(face[234], face[454])
    : null;
  if (distanceRatio !== null) distanceStatus = distanceRatio < 0.12 ? "Too Far" : "Good";
  const status = (settings.monitor_face_missing || settings.show_detection_overlay) && !faceDetected
    ? "Face Not Detected"
    : settings.monitor_posture && shoulderAvailability.status === "checking"
      ? "Checking for shoulders"
        : settings.monitor_posture && shoulderAvailability.status === "missing"
      ? "Reframe to include shoulders"
        : settings.monitor_posture && !shouldersVisible
        ? "Shoulders temporarily not detected"
        : settings.monitor_posture && stableShoulderMisalignment
        ? "Reframe to align shoulders"
        : settings.monitor_looking_away && lookingAway
        ? "Head Turn Detected"
        : settings.monitor_eye_closure && eyesClosed
          ? "Eyes Closed"
            : settings.monitor_posture && posture === "Slouching"
            ? "Slouching"
              : settings.monitor_distance && distanceStatus === "Too Far"
              ? "Too Far"
              : "No alert signals";

  return {
    face_detected: Boolean(
      faceResult &&
      (settings.monitor_looking_away || settings.monitor_eye_closure
        || settings.monitor_face_missing || settings.monitor_distance
        || settings.show_detection_overlay),
    ) ? faceDetected : null,
    eyes_closed: settings.monitor_eye_closure ? eyesClosed : null,
    looking_away: settings.monitor_looking_away ? lookingAway : null,
    pose_detected: settings.monitor_posture ? poseDetected : null,
    pose_detection_status: poseDetectionStatus,
    ear: ear === null ? null : Math.round(ear * 1000) / 1000,
    head_turn_ratio: turnRatio === null ? null : Math.round(turnRatio * 1000) / 1000,
    posture,
    posture_angle:
      postureAngle === null ? null : Math.round(postureAngle * 100) / 100,
    shoulder_tilt_angle:
      shoulderTilt === null ? null : Math.round(shoulderTilt * 100) / 100,
    distance_ratio:
      distanceRatio === null ? null : Math.round(distanceRatio * 1000) / 1000,
    distance_status: distanceStatus,
    status,
    thresholds: {
      ear_closed_below: settings.monitor_eye_closure ? 0.2 : null,
      head_turn_ratio_above: settings.monitor_looking_away ? HEAD_TURN_THRESHOLD : null,
      slouch_angle_below_degrees: settings.monitor_posture ? SLOUCH_ANGLE_DEGREES : null,
      distance_face_width_below: settings.monitor_distance ? 0.12 : null,
      shoulder_tilt_activate_degrees: settings.monitor_posture ? SHOULDER_TILT_ACTIVATE_DEGREES : null,
      shoulder_tilt_clear_degrees: settings.monitor_posture ? SHOULDER_TILT_CLEAR_DEGREES : null,
    },
  };
}
