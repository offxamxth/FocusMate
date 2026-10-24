import { changelog, sortReleasesByVersion } from './changelog.js';
import { textDirection, translate } from './i18n.js';

const sections = [
  ['getting-started', 'Getting started'],
  ['focus-sessions', 'Focus sessions'],
  ['features', 'Feature guides'],
  ['focus-score', 'Focus Score'],
  ['privacy', 'Privacy and data'],
  ['troubleshooting', 'Troubleshooting and FAQs'],
  ['updates', 'Update history'],
];

export default function DocumentationPage({ publicPage = false, language = 'en' }) {
  const rootClass = publicPage
    ? 'documentation-page documentation-page-public public-content'
    : 'documentation-page documentation-page-app page-content';
  const t = (key, values = {}) => translate(language, `changelog.${key}`, values);
  const sortedReleases = sortReleasesByVersion(changelog.releases);
  const latestRelease = sortedReleases[0];
  const olderReleases = sortedReleases.slice(1);
  const dateLabel = (date) => new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  const renderChange = (entry) => (
    <article className="changelog-card" key={entry.commit || entry.version || entry.date || entry.title}>
      <div className="changelog-card-meta">
        {entry.version && <span className="changelog-version">{entry.version}</span>}
        {entry.date && <time dateTime={entry.date}>{dateLabel(entry.date)}</time>}
      </div>
      <h3>{entry.title}</h3>
      {entry.summary && <p>{entry.summary}</p>}
      {entry.commit && (
        <a
          className="changelog-commit"
          href={`https://github.com/offxamxth/FocusMate/commit/${entry.commit}`}
        >
          {t('commit')} <code>{entry.commit}</code>
        </a>
      )}
      {entry.category && (
        <span className={`changelog-category changelog-category-${entry.category}`}>
          {t(`category.${entry.category}`)}
        </span>
      )}
    </article>
  );

  return (
    <div className={rootClass} lang={language} dir={textDirection(language)}>
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
        <p>Pausing a focus session stops its camera stream and excludes paused time from the recorded session duration. Navigating to another FocusMate page or switching browser tabs does not intentionally stop an active camera; the browser may reduce background processing. Use Stop camera or pause the session to turn it off.</p>
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
            <h3>Daily quests</h3>
            <p>Browser-local profiles receive four daily quests based on recorded timer time, completed camera sessions, session XP, and enabled camera signals; rewards are added to that local profile once. Cloud profiles receive a separate set of server-verified Focus Room quests using the UTC day. Completing at least three eligible verified quests awards one reroll token per UTC day; each reroll spends a token, with a limit of three rerolls per UTC day.</p>
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
            <p>Cloud social features require sign-in and an internet connection. The Global board lists public profiles; the Friends board lists accepted friends who chose Friends or Public visibility. You can choose Private, Friends, or Public visibility, and still see your own XP and level when unlisted. Rankings use persisted Global XP and a database function; a missing or incompatible server function is reported instead of replaced with sample data.</p>
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
            <p>FocusMate keeps an active camera stream running when you navigate to another app page or switch browser tabs. Browsers and devices may throttle background analysis; return to the app to resume normal processing. Stop the camera or pause the focus session to end it.</p>
          </details>
          <details>
            <summary>Why is the leaderboard unavailable or reporting an outdated response?</summary>
            <p>The leaderboard needs an authenticated cloud account, a network connection, and the current Global XP database functions. Retry after reconnecting or signing in again. If an update-required message persists, contact support so the service deployment can be checked.</p>
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
        <h2>{t('title')}</h2>
        <p>{t('intro')}</p>
        <nav className="changelog-nav" aria-label={t('navigation')}>
          <a href="#unreleased">{t('unreleased')}</a>
          <a href="#release-policy">{t('policy')}</a>
          <a href="#release-history">{t('history')}</a>
        </nav>

        <section id="unreleased" className="changelog-section" aria-labelledby="unreleased-title">
          <div className="changelog-section-heading">
            <div>
              <span className="changelog-status">{t('unreleased')}</span>
              <h3 id="unreleased-title">{t('latestActivity')}</h3>
            </div>
            {changelog.unreleased[0]?.date && (
              <time dateTime={changelog.unreleased[0].date}>
                {dateLabel(changelog.unreleased[0].date)}
              </time>
            )}
          </div>
          <div className="changelog-cards">
            {changelog.unreleased.map(renderChange)}
          </div>
        </section>

        <section id="release-policy" className="changelog-policy" aria-labelledby="release-policy-title">
          <span className="documentation-kicker">{t('versioning')}</span>
          <h3 id="release-policy-title">{t('policy')}</h3>
          <p>{t('noPublishedReleases')}</p>
          <p>{t('format')} <strong>MAJOR.MINOR.PATCH</strong></p>
          <p>{t('proposedVersion')} <strong>{changelog.proposedInitialVersion}</strong> — {t('proposedVersionNote')}</p>
          <ul>
            <li><strong>MAJOR</strong> — {t('major')}</li>
            <li><strong>MINOR</strong> — {t('minor')}</li>
            <li><strong>PATCH</strong> — {t('patch')}</li>
          </ul>
        </section>

        <section id="release-history" className="changelog-section" aria-labelledby="release-history-title">
          <h3 id="release-history-title">{t('publishedReleases')}</h3>
          {latestRelease
            ? (
              <>
                <span className="changelog-latest-label">{t('latestRelease')}</span>
                <div className="changelog-cards">{renderChange(latestRelease)}</div>
                {olderReleases.length > 0 && (
                  <details className="changelog-disclosure">
                    <summary>{t('olderReleases', { count: olderReleases.length })}</summary>
                    <div className="changelog-cards">
                      {olderReleases.map(renderChange)}
                    </div>
                  </details>
                )}
              </>
            )
            : <p className="changelog-empty">{t('noPublishedReleases')}</p>}
        </section>

        <details className="changelog-disclosure changelog-commit-history">
          <summary>{t('confirmedHistory', { count: changelog.history.length })}</summary>
          <p>{t('historyNote')}</p>
          <div className="changelog-cards">
            {changelog.history.map(renderChange)}
          </div>
        </details>
      </section>
      <p className="documentation-footnote">{t('footnote')}</p>
    </div>
  );
}
