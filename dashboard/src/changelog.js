const releaseHistory = [
  {
    date: '2026-10-19',
    commit: '198156f',
    title: 'Session recovery, leaderboard, and buddy sounds',
    summary: 'Clarified early session completion and retryable session saves, improved missing leaderboard-function errors, added optional Focus Buddy appearance sounds, and linked Documentation from the signed-out home page.',
    category: 'improved',
  },
  {
    date: '2026-10-18',
    commit: 'e824c4b',
    title: 'Progression and room video',
    summary: 'Added Focus Buddy support and room video features, with related progression, room, and leaderboard updates.',
    category: 'added',
  },
  {
    date: '2026-10-17',
    commit: '67d736f',
    title: 'Focus Buddy reminders and translations',
    summary: 'Improved Focus Buddy reminders and added translations.',
    category: 'improved',
  },
  {
    date: '2026-10-17',
    commit: 'eee24a7',
    title: 'Room, leaderboard, and profile updates',
    summary: 'Updated FocusMate rooms, leaderboard, and profile features.',
    category: 'improved',
  },
  {
    date: '2026-10-16',
    commit: 'e6658e3',
    title: 'Leaderboard authentication handling',
    summary: 'Fixed leaderboard authentication handling.',
    category: 'fixed',
  },
  {
    date: '2026-10-12',
    commit: '78e2f8c',
    title: 'Focus Room quest reroll XP',
    summary: 'Fixed XP handling when rerolling Focus Room quests.',
    category: 'fixed',
  },
  {
    date: '2026-10-11',
    commit: 'df8251b',
    title: 'Multiplayer focus-session synchronization',
    summary: 'Synchronized multiplayer focus sessions.',
    category: 'improved',
  },
  {
    date: '2026-10-10',
    commit: '5fe0ea6',
    title: 'Public pages and PWA navigation',
    summary: 'Finalized public pages and installable-app navigation.',
    category: 'added',
  },
  {
    date: '2026-10-09',
    commit: '593e037',
    title: 'Installable FocusMate',
    summary: 'Added installable Progressive Web App support.',
    category: 'added',
  },
];

export const changelog = {
  proposedInitialVersion: 'v1.0.0',
  unreleased: [
    {
      date: '2026-10-24',
      title: 'Leaderboard, daily quests, and one documentation route',
      summary: 'Applied the missing production leaderboard and verified daily-quest database support, corrected timer and camera-session quest accounting, documented privacy and reroll rules, and consolidated Documentation links on the main app’s #documentation section.',
      category: 'improved',
    },
    {
      date: '2026-10-22',
      commit: 'dfa456a',
      title: 'Availability of room video and verified quests',
      summary: 'Kept room video and verified quests hidden when their required support is unavailable.',
      category: 'changed',
    },
    {
      date: '2026-10-22',
      commit: 'edb1576',
      title: 'Safer release preparation',
      summary: 'Documented release setup and clarified the cloud configuration example.',
      category: 'reliability',
    },
    {
      date: '2026-10-21',
      commit: '41c204f',
      title: 'Verified daily-quest availability',
      summary: 'Clarified when verified daily quests are available and added regression coverage.',
      category: 'improved',
    },
    {
      date: '2026-10-20',
      commit: '2282af3',
      title: 'Daily quest token progress',
      summary: 'Updated daily quest progress and reward messaging for the three-quest token milestone.',
      category: 'improved',
    },
    {
      date: '2026-10-20',
      commit: 'afae49a',
      title: 'Verified daily-quest token rewards',
      summary: 'Added a once-per-day reroll token reward after three eligible verified daily quests.',
      category: 'added',
    },
    {
      date: '2026-10-19',
      commit: 'e20c01c',
      title: 'FocusMate documentation guide',
      summary: 'Updated the guide with current feature information and support guidance.',
      category: 'improved',
    },
  ],
  releases: [],
  history: releaseHistory,
};

const semanticVersionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function semanticVersionParts(version) {
  const match = semanticVersionPattern.exec(version);
  if (!match) throw new TypeError(`Invalid Semantic Version: ${version}`);
  return match.slice(1).map(Number);
}

export function compareSemanticVersions(left, right) {
  const leftParts = semanticVersionParts(left);
  const rightParts = semanticVersionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

export function sortReleasesByVersion(releases) {
  return [...releases].sort((left, right) => (
    compareSemanticVersions(right.version, left.version)
  ));
}
