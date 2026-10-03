import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const HEAD_TURN_THRESHOLD = 0.24;

export async function createVisionLandmarkers() {
  const files = await FilesetResolver.forVisionTasks(WASM_URL);
  const face = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/models/face_landmarker.task" },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  try {
    const pose = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker.task" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    return { face, pose };
  } catch (error) {
    face.close();
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

export function estimateHeadTurn(landmarks) {
  const nose = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const leftSpan = Math.abs(nose.x - leftCheek.x);
  const rightSpan = Math.abs(rightCheek.x - nose.x);
  const total = leftSpan + rightSpan;
  return (
    total > 0 && Math.abs(leftSpan - rightSpan) / total > HEAD_TURN_THRESHOLD
  );
}

export function detectMetrics(detectors, video, timestamp) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const faceResult = detectors.face.detectForVideo(video, timestamp);
  const face = faceResult.faceLandmarks?.[0];
  const faceDetected = Boolean(face);
  const lookingAway = faceDetected && estimateHeadTurn(face);
  const ear = faceDetected
    ? (eyeAspectRatio(face, LEFT_EYE, width, height) +
        eyeAspectRatio(face, RIGHT_EYE, width, height)) /
      2
    : null;
  const eyesClosed = ear !== null && ear < 0.2;

  const poseResult = detectors.pose.detectForVideo(video, timestamp);
  const pose = poseResult.poseLandmarks?.[0];
  let posture = "Unknown";
  let postureAngle = null;
  const visible = (point) =>
    point &&
    (point.visibility == null || point.visibility >= 0.5) &&
    (point.presence == null || point.presence >= 0.5);
  const shoulderEarPairs = [
    [7, 11],
    [8, 12],
  ].filter(
    ([ear, shoulder]) => visible(pose?.[ear]) && visible(pose?.[shoulder]),
  );
  if (shoulderEarPairs.length) {
    const angles = shoulderEarPairs.map(
      ([ear, shoulder]) =>
        (Math.atan2(
          Math.abs(pose[ear].y - pose[shoulder].y),
          Math.abs(pose[ear].x - pose[shoulder].x),
        ) *
          180) /
        Math.PI,
    );
    postureAngle =
      angles.reduce((total, angle) => total + angle, 0) / angles.length;
    posture = postureAngle < 60 ? "Slouching" : "Good";
  }

  let distanceStatus = "Unknown";
  if (faceDetected)
    distanceStatus =
      landmarkDistance(face[234], face[454]) < 0.12 ? "Too Far" : "Good";
  const status = !faceDetected
    ? "Face Not Detected"
    : !shoulderEarPairs.length
      ? "Reframe to include shoulders"
      : lookingAway
        ? "Head Turn Detected"
        : eyesClosed
          ? "Eyes Closed"
          : posture === "Slouching"
            ? "Slouching"
            : distanceStatus === "Too Far"
              ? "Too Far"
              : "No alert signals";

  return {
    face_detected: faceDetected,
    eyes_closed: eyesClosed,
    looking_away: lookingAway,
    pose_detected: Boolean(shoulderEarPairs.length),
    ear: ear === null ? null : Math.round(ear * 1000) / 1000,
    posture,
    posture_angle:
      postureAngle === null ? null : Math.round(postureAngle * 100) / 100,
    distance_status: distanceStatus,
    status,
  };
}
