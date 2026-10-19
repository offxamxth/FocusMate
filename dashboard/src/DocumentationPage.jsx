const updates = [
  {
    date: 'October 19, 2026',
    commit: '198156f',
    title: 'Session recovery, leaderboard, and buddy sounds',
    detail: 'Clarified early session completion and retryable session saves, improved missing leaderboard-function errors, added optional Focus Buddy appearance sounds, and linked Documentation from the signed-out home page.',
  },
  {
    date: 'October 18, 2026',
    commit: 'e824c4b',
    title: 'Progression and room video',
    detail: 'Added Focus Buddy support and room video features, with related progression, room, and leaderboard updates.',
  },
  {
    date: 'October 17, 2026',
    commit: '67d736f',
    title: 'Focus Buddy reminders and translations',
    detail: 'Improved Focus Buddy reminders and added translations.',
  },
  {
    date: 'October 17, 2026',
    commit: 'eee24a7',
    title: 'Room, leaderboard, and profile updates',
    detail: 'Updated FocusMate rooms, leaderboard, and profile features.',
  },
  {
    date: 'October 16, 2026',
    commit: 'e6658e3',
    title: 'Leaderboard authentication handling',
    detail: 'Fixed leaderboard authentication handling.',
  },
  {
    date: 'October 12, 2026',
    commit: '78e2f8c',
    title: 'Focus Room quest reroll XP',
    detail: 'Fixed XP handling when rerolling Focus Room quests.',
  },
  {
    date: 'October 11, 2026',
    commit: 'df8251b',
    title: 'Multiplayer focus-session synchronization',
    detail: 'Synchronized multiplayer focus sessions.',
  },
  {
    date: 'October 10, 2026',
    commit: '5fe0ea6',
    title: 'Public pages and PWA navigation',
    detail: 'Finalized public pages and installable-app navigation.',
  },
  {
    date: 'October 9, 2026',
    commit: '593e037',
    title: 'Installable FocusMate',
    detail: 'Added installable Progressive Web App support.',
  },
];

const sections = [
  ['getting-started', 'Getting started'],
  ['focus-sessions', 'Focus sessions'],
  ['features', 'Feature guides'],
  ['focus-score', 'Focus Score'],
  ['privacy', 'Privacy and data'],
  ['troubleshooting', 'Troubleshooting and FAQs'],
  ['updates', 'Update history'],
];

export default function DocumentationPage({ publicPage = false }) {
  const rootClass = publicPage
    ? 'documentation-page documentation-page-public public-content'
    : 'documentation-page documentation-page-app page-content';

  return (
    <div className={rootClass} lang="en" dir="ltr">
      {publicPage && (
        <header className="documentation-hero">
          <span className="public-eyebrow">FOCUSMATE HELP</span>
          <h1>Documentation</h1>
          <p>A practical guide to FocusMate’s current features, privacy controls, and support options.</p>
          <a className="public-primary-link" href="/#overview">Open FocusMate</a>
        </header>
      )}

      <nav className="documentation-toc" aria-label="Documentation contents">
        <strong>On this page</strong>
        <div>
          {sections.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}
        </div>
      </nav>

      <section id="getting-started" className="documentation-section">
        <span className="documentation-kicker">01 · FIRST STEPS</span>
        <h2>Getting started</h2>
        <ol className="documentation-steps">
          <li><strong>Choose a profile.</strong> Create or open a browser-local profile, or sign in with a supported cloud account. Local profile data is stored in this browser; cloud features require a connection.</li>
          <li><strong>Pick one small goal.</strong> Add a task or open the Focus page and describe what you plan to work on. Select how you are feeling before starting a focus session.</li>
          <li><strong>Start with the tools you want.</strong> The timer works without camera access. Webcam support is optional and requires your explicit action and browser permission.</li>
          <li><strong>Review your progress.</strong> Use My Progress, Session results, achievements, and quests to review information FocusMate actually recorded.</li>
        </ol>
        <a href="/#focus">Go to Focus</a>
      </section>

      <section id="focus-sessions" className="documentation-section">
        <span className="documentation-kicker">02 · FOCUS SESSIONS</span>
        <h2>Timer, pause, and session recovery</h2>
        <p>Choose a 15, 25, 45, 60, 90, or 120 minute timer. A focus timer can be paused and resumed; ending it early is shown as an early end rather than a completed session.</p>
        <p>Moving between pages inside FocusMate does not end the timer. The countdown is kept in this tab’s session storage so a refresh in the same tab can restore the remaining time. Closing the tab or clearing its session storage removes that recovery state.</p>
        <p>Pausing or leaving the Focus Room stops an active camera stream and excludes paused time from the recorded session duration. Return to the Focus Room and explicitly start the camera again if you want local webcam support to continue.</p>
      </section>

      <section id="features" className="documentation-section">
        <span className="documentation-kicker">03 · FEATURE GUIDES</span>
        <h2>Tools for your study routine</h2>
        <div className="documentation-feature-grid">
          <article>
            <h3>Tasks and progress</h3>
            <p>Use tasks, study goals, session history, achievements, and daily quests to organize and review your activity. Saved data depends on whether you use a local or cloud profile.</p>
          </article>
          <article>
            <h3>Focus Buddy</h3>
            <p>Choose whether Focus Buddy is enabled and select its appearance in Session preferences. Buddy appearance sounds are optional, use a short locally synthesized chime, and can be turned off separately. Audio starts only after browser interaction; camera and microphone access are not needed.</p>
          </article>
          <article>
            <h3>Optional webcam signals</h3>
            <p>MediaPipe processes camera frames in the browser to estimate enabled face, eye-closure, head-turn, posture, and screen-distance signals. These are approximate cues, not attention measurements. Frames and landmarks are not saved as session history.</p>
          </article>
          <article>
            <h3>Focus Rooms</h3>
            <p>Cloud accounts can use shared rooms. Room timing and verified room progress are server-controlled; room video is an optional, separate connection that shares live media only after you choose to connect and enable a device.</p>
          </article>
          <article>
            <h3>Friends and leaderboard</h3>
            <p>Cloud social features require sign-in and an internet connection. Leaderboard visibility is controlled by your privacy setting. Rankings use persisted profile XP and the configured database function; an incompatible server response is reported instead of replaced with sample data.</p>
          </article>
        </div>
      </section>

      <section id="focus-score" className="documentation-section documentation-callout">
        <span className="documentation-kicker">04 · IMPORTANT CONTEXT</span>
        <h2>Focus Score</h2>
        <p>FocusMate does not currently show a Focus Score. The former score UI was removed. Session duration and optional camera-derived signals are separate records; none is a score or proof of concentration, learning, or mental state.</p>
      </section>

      <section id="privacy" className="documentation-section">
        <span className="documentation-kicker">05 · PRIVACY</span>
        <h2>Privacy and data</h2>
        <ul>
          <li>Local profiles and preferences are stored in browser storage. Cloud profiles synchronize supported profile data with Supabase.</li>
          <li>Camera access is optional. Video analysis runs in the browser; derived statuses and counts may be saved to session records.</li>
          <li>Room video is distinct from local analysis: if connected and enabled, live camera or microphone media is shared with active room members.</li>
          <li>Cloud sign-in, synchronization, social features, and room operations need an internet connection.</li>
        </ul>
        <a href="/privacy">Read the full Privacy Policy</a>
      </section>

      <section id="troubleshooting" className="documentation-section">
        <span className="documentation-kicker">06 · HELP</span>
        <h2>Troubleshooting and FAQs</h2>
        <div className="documentation-faq">
          <details>
            <summary>Why is my timer unavailable after opening a different tab?</summary>
            <p>Timer recovery is scoped to the original browser tab. Return to that tab; opening a separate tab does not share its session-storage timer state.</p>
          </details>
          <details>
            <summary>Why did webcam support stop when I changed pages?</summary>
            <p>FocusMate stops an active camera stream when you leave the Focus Room page. Reopen Focus Room and start the camera again if you want camera support.</p>
          </details>
          <details>
            <summary>Why is the leaderboard unavailable or reporting an outdated response?</summary>
            <p>The leaderboard needs an authenticated cloud account, a network connection, and a database function returning the current Global XP response. Retry after reconnecting or signing in again. If the outdated-response message persists, contact support so the service deployment can be checked.</p>
          </details>
          <details>
            <summary>Does FocusMate measure my attention?</summary>
            <p>No. Camera signals are approximate browser-side cues and are not a measure or proof of attention. The timer records elapsed study time.</p>
          </details>
          <details>
            <summary>Where can I report a problem?</summary>
            <p>Use <a href="/#contact">Contact Us</a> to send support a question or report.</p>
          </details>
        </div>
      </section>

      <section id="updates" className="documentation-section">
        <span className="documentation-kicker">07 · PROJECT HISTORY</span>
        <h2>Update history</h2>
        <p>This short history is based on commits present in the FocusMate repository; it is not a promise that every deployment has the same database or provider configuration.</p>
        <ol className="documentation-updates">
          {updates.map((update) => (
            <li key={update.commit}>
              <time>{update.date}</time>
              <div>
                <strong>{update.title}</strong>
                <p>{update.detail}</p>
                <code>{update.commit}</code>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <p className="documentation-footnote">Documentation content reviewed for the FocusMate project history through October 19, 2026.</p>
    </div>
  );
}
