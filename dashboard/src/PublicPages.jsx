import { useEffect, useState } from 'react';
import ContactPage from './ContactPage.jsx';
import {
  browserLanguage,
  supportedLanguages,
  textDirection,
  translate,
} from './i18n.js';
import './public-pages.css';

const siteUrl = 'https://getfocusmate.vercel.app';
const socialImage = `${siteUrl}/icons/focusmate-512.png`;

export const PUBLIC_PAGE_METADATA = {
  about: {
    title: 'About FocusMate | A Study Space for Focus and Progress',
    description: 'Learn about FocusMate, a study app for focus sessions, tasks, progress tracking, and optional in-browser webcam feedback.',
    url: `${siteUrl}/about`,
  },
  contact: {
    title: 'Contact FocusMate | Help and Support',
    description: 'Contact FocusMate support, report an issue, share feedback, or find answers in the frequently asked questions.',
    url: `${siteUrl}/contact`,
  },
  privacy: {
    title: 'Privacy Policy | FocusMate',
    description: 'Read how FocusMate handles account, study, optional webcam-derived, and support information.',
    url: `${siteUrl}/privacy`,
  },
  'not-found': {
    title: 'Page Not Found | FocusMate',
    description: 'The requested FocusMate page could not be found.',
    robots: 'noindex, nofollow',
  },
};

const privacySections = [
  {
    id: 'scope',
    title: 'About this notice',
    paragraphs: [
      'This notice describes the data flows visible in the FocusMate application source code and database policies reviewed for this page. It is not a promise about provider practices that FocusMate cannot verify.',
      'FocusMate is a study and student-wellbeing app. It is not an AI-powered app, a medical service, or a diagnostic tool. The optional webcam feature provides approximate study-session signals, not a measure or proof of attention.',
    ],
  },
  {
    id: 'information',
    title: 'Information FocusMate handles',
    paragraphs: [
      'Depending on the features you use, the app can handle a username, display name, account identifiers, language and theme preferences, study goals, subjects, tasks, progress, achievements, session history, and wellbeing entries such as sleep, water, and reflections.',
      'In local mode, this information is kept in browser storage. When you use a cloud account, profile information and app data are synchronized to a FocusMate profile in Supabase. The app also stores the Supabase sign-in session in browser storage.',
    ],
  },
  {
    id: 'sign-in',
    title: 'Sign-in information',
    paragraphs: [
      'The regular FocusMate account flow asks for a username and a six-digit PIN, not a contact email address. The authentication function processes the PIN and stores a salted PBKDF2-derived verifier in its custom credential table rather than the PIN in plaintext. It also uses a generated, non-contact Supabase Auth email identity and an HMAC-derived Auth password bridge. Supabase Auth session credentials are then held by the browser client; provider-side storage and logs are outside what the app source can establish.',
      'An optional migration flow for older accounts asks for the existing account email and password and submits them to the authentication function to verify the account. On successful migration the password is replaced with the PIN-based Auth password bridge. Provider-side handling beyond these application calls is not established by the repository.',
    ],
  },
  {
    id: 'webcam',
    title: 'Optional webcam processing',
    paragraphs: [
      'Webcam access is optional and is requested when you start a camera-supported session. Video frames and face/pose landmarks are processed in the browser. The frame-analysis code passes derived metrics to the app’s local JavaScript API handler; the inspected code does not make a network request containing frames or landmarks.',
      'Depending on the monitoring options enabled, the app derives face-presence, looking-away/head-turn, posture, eye-closure, and screen-distance statuses. During a session it saves statuses, alert counts, the selected detection configuration, and a timeline of up to 120 points containing elapsed minutes and alert-count snapshots in browser storage. Numeric intermediates such as eye-aspect ratio, head-turn ratio, posture angles, distance ratio, and thresholds are removed before that live record is saved. Completed profile history stores a session summary and selected configuration, not the live timeline, frames, landmarks, or those numeric intermediates. The completed live record remains in browser storage until a later camera session replaces it or browser site data is cleared.',
      'Disabling a signal stops that signal from being evaluated and counted while it is off; camera processing may continue for other enabled signals or the overlay. It does not erase earlier timeline points or completed session records. The current live summary marks disabled signals as not monitored or null. The configuration and completed session summary are also part of the profile data synchronized for cloud accounts.',
    ],
  },
  {
    id: 'storage',
    title: 'Browser storage and offline use',
    paragraphs: [
      'FocusMate stores local profiles and preferences in browser storage. Cloud account profile data—including tasks, study plans, session history, reflections, and wellbeing entries—is mirrored locally and synchronized as the profile’s app-data snapshot in Supabase. The Supabase Auth session is also stored by the browser client. Logging out does not delete those local profile copies, completed session history, or the cloud profile.',
      'The service worker precaches the app shell and static application assets; the computer-vision model files are excluded. Public About, Contact, and Privacy documents are excluded from the navigation fallback and are not runtime-cached, so they are requested from the server. The configured worker has no caching rule for API responses or profile data. Cloud sign-in, synchronization, social features, and room operations require a connection.',
    ],
  },
  {
    id: 'support',
    title: 'Support requests',
    paragraphs: [
      'If you submit a support, bug-report, or feedback form, the form sends the fields you provide (which may include your email address, issue description, bug details, or feedback) together with your username when available, browser, device/platform, and app version to Web3Forms for delivery to FocusMate support.',
      'An image selected in the form is not included in that form submission. You may choose to attach it yourself when emailing support. Direct support email is handled by your email provider and FocusMate’s support mailbox.',
    ],
  },
  {
    id: 'sharing',
    title: 'When information may be visible to others',
    paragraphs: [
      'The profiles table and its app-data snapshot are owner-scoped. Separate authenticated search and friend functions expose a matching username, display name, and relationship/request status; accepted friends can see each other’s username and display name and the app publishes online presence only to accepted friends. These functions do not grant friends access to another person’s tasks, reflections, or full profile snapshot.',
      'Leaderboard visibility defaults to private. If changed to friends, accepted friends can see that account in the friends board; if changed to public, eligible signed-in users can see it in the global board. Leaderboard results expose rank, username, display name, and verified room-focus seconds—not personal session history or task/reflection data.',
      'Active room participants can see the room name, code, state, timing details, and participant usernames, display names, roles, and join times. Leaving an active room records a leave time; finishing a room marks it finished and does not itself delete the room or its membership/history rows. A later leave action on an already closed room can remove that member row. Closed-room data otherwise remains available to previous participants under the reviewed policies. These records are not a public profile feed.',
      'The app uses Supabase for authentication and cloud data, Vercel for hosting, and Web3Forms for submitted support forms. Those provider integrations are visible in the app configuration/code; provider locations, subprocessors, independent logging, backups, and retention practices were not established by this review and should be confirmed with the service operator and providers.',
    ],
  },
  {
    id: 'retention',
    title: 'Retention and deletion',
    paragraphs: [
      'Some browser-side records are bounded: the camera timeline keeps at most 120 points, completed camera-session history at most 1,000 entries, and session reflections at most 100. Removing a task removes it from the current profile data; cloud profile changes are synchronized as an updated snapshot. The reviewed code and database setup do not state a general retention period for cloud profile data, room records, support submissions, or provider logs.',
      'There is no self-service account-deletion feature in the app. Logging out ends the current sign-in state but is not account or data deletion. The database schema uses cascading foreign keys for the Auth user’s profile, PIN credential, friendship rows, room ownership/membership, and verified room-focus segments if that Auth user is deleted. This schema behavior does not establish a user-facing deletion process, removal from provider backups/logs, or a deletion timetable. Contact support to ask about a request; no outcome or completion time is promised here.',
      'Clearing browser site data removes browser-local copies and sign-in state, but does not delete a cloud account or its Supabase profile. Removing a friend changes the friendship row to a removed status rather than deleting it. Leaving a room records a departure; completing a room marks it finished. Neither action is a general deletion request.',
    ],
  },
  {
    id: 'security',
    title: 'Security and your choices',
    paragraphs: [
      'The reviewed database policies restrict direct profile access to the account owner and limit social data through authenticated functions and room/friend membership rules. These controls do not guarantee that a system is completely secure. Keep your PIN private, use a device you trust, review your leaderboard visibility, and only enable webcam monitoring when you want it.',
      'FocusMate is designed for students, but the reviewed app and public site do not specify a minimum age or a parental-consent process. The appropriate age and consent requirements need to be confirmed with the service operator and qualified legal counsel before publication.',
    ],
  },
  {
    id: 'changes-contact',
    title: 'Changes and contact',
    paragraphs: [
      'This notice was last updated on October 10, 2026. It may need to change when the app or its providers change. Please review it again after a material update.',
      'For privacy questions, use the Contact Us page or email support.focusmate@gmail.com. This page describes current observed app behavior and is not legal advice; the service operator should review it for the applicable jurisdiction before relying on it as a legal notice.',
    ],
  },
];

function updateMetadata(metadata) {
  document.title = metadata.title;
  document.documentElement.lang = 'en';

  const setMeta = (selector, attribute, value, create) => {
    let element = document.head.querySelector(selector);
    if (!element && create) {
      element = document.createElement('meta');
      document.head.append(element);
    }
    if (element) element.setAttribute(attribute, value);
  };
  const setLink = (selector, rel, href) => {
    let element = document.head.querySelector(selector);
    if (!element) {
      element = document.createElement('link');
      element.rel = rel;
      document.head.append(element);
    }
    element.href = href;
  };

  setMeta('meta[name="description"]', 'content', metadata.description, true);
  setMeta('meta[name="robots"]', 'content', metadata.robots || 'index, follow', true);
  setMeta('meta[property="og:type"]', 'content', 'website', true);
  if (metadata.url) {
    setMeta('meta[property="og:url"]', 'content', metadata.url, true);
    setLink('link[rel="canonical"]', 'canonical', metadata.url);
  } else {
    document.head.querySelector('link[rel="canonical"]')?.remove();
    document.head.querySelector('meta[property="og:url"]')?.remove();
  }
  setMeta('meta[property="og:title"]', 'content', metadata.title, true);
  setMeta('meta[property="og:description"]', 'content', metadata.description, true);
  setMeta('meta[property="og:image"]', 'content', socialImage, true);
  setMeta('meta[name="twitter:card"]', 'content', 'summary', true);
  setMeta('meta[name="twitter:title"]', 'content', metadata.title, true);
  setMeta('meta[name="twitter:description"]', 'content', metadata.description, true);
  setMeta('meta[name="twitter:image"]', 'content', socialImage, true);
}

function PublicHeader({ language, onLanguageChange }) {
  const t = (key) => translate(language, `public.${key}`);
  return (
    <header className="public-header">
      <a className="public-brand" href="/" aria-label={t('home')}>
        <img src="/icons/focusmate.svg" width="36" height="36" alt="" />
        <span>FocusMate</span>
      </a>
      <nav className="public-nav" aria-label={t('navigation')}>
        <a href="/about">{t('about')}</a>
        <a href="/privacy">{t('privacy')}</a>
        <a href="/contact">{t('contact')}</a>
      </nav>
      <label className="public-language">
        <span>{t('language')}</span>
        <select
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
        >
          {supportedLanguages.map((code) => (
            <option key={code} value={code}>{translate(language, `language.${code}`)}</option>
          ))}
        </select>
      </label>
    </header>
  );
}

function AboutContent() {
  return (
    <div className="public-content">
      <section className="public-hero">
        <span className="public-eyebrow">A STUDY SPACE BUILT AROUND YOUR NEXT STEP</span>
        <h1>Make room for focused study.</h1>
        <p>FocusMate brings study sessions, small goals, and progress reflections together in one calm space. Choose the tools that help you and leave the rest turned off.</p>
        <a className="public-primary-link" href="/">Open FocusMate</a>
      </section>

      <section className="public-section" aria-labelledby="about-tools">
        <h2 id="about-tools">A practical set of study tools</h2>
        <div className="public-feature-grid">
          <article><h3>Plan the next step</h3><p>Keep tasks, goals, subjects, and study notes together so it is easier to decide what to work on next.</p></article>
          <article><h3>Build a study rhythm</h3><p>Use focus timers, session history, progress summaries, and achievements to reflect on your own routine.</p></article>
          <article><h3>Study together</h3><p>Cloud accounts can connect with friends, join Focus Rooms, and use a verified room leaderboard with visibility controls.</p></article>
        </div>
      </section>

      <section className="public-section public-note" aria-labelledby="about-camera">
        <h2 id="about-camera">Optional webcam feedback</h2>
        <p>Camera-supported sessions are optional. When enabled, FocusMate processes video in your browser to estimate a small set of session signals, such as face presence, head-turn/looking-away, posture, eye closure, and screen distance. These are approximate computer-vision cues, not a diagnosis, a precise gaze measurement, or proof of concentration. Timer-only sessions remain available without webcam access.</p>
        <a href="/privacy#webcam">Read about webcam data and storage</a>
      </section>

      <section className="public-section public-cta" aria-labelledby="about-help">
        <h2 id="about-help">Questions before you begin?</h2>
        <p>Visit the help page for installation instructions and answers to common questions.</p>
        <a href="/contact">Contact Us and read the FAQs</a>
      </section>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="public-content privacy-content" lang="en" dir="ltr">
      <section className="public-hero">
        <span className="public-eyebrow">FOCUSMATE</span>
        <h1>Privacy Policy</h1>
        <p>A plain-language description of how the current app handles account, study, optional webcam-derived, and support information.</p>
        <p className="privacy-updated">Last updated: October 10, 2026</p>
      </section>
      <nav className="privacy-toc" aria-label="Privacy policy contents">
        <h2>On this page</h2>
        <ol>
          {privacySections.map((section) => (
            <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
          ))}
        </ol>
      </nav>
      <article className="privacy-article">
        {privacySections.map((section) => (
          <section id={section.id} key={section.id} className="public-section">
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
      </article>
    </div>
  );
}

function NotFoundContent() {
  return (
    <div className="public-content public-not-found">
      <section className="public-hero">
        <span className="public-eyebrow">FOCUSMATE</span>
        <h1>Page not found</h1>
        <p>That page is not available. Check the address or return to FocusMate.</p>
        <a className="public-primary-link" href="/">Go to FocusMate</a>
      </section>
    </div>
  );
}

export default function PublicPages({ page, metadata }) {
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('focusmate-language');
    return supportedLanguages.includes(saved) ? saved : browserLanguage();
  });

  useEffect(() => {
    updateMetadata(metadata);
  }, [metadata]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = textDirection(language);
  }, [language]);

  const changeLanguage = (nextLanguage) => {
    if (!supportedLanguages.includes(nextLanguage)) return;
    localStorage.setItem('focusmate-language', nextLanguage);
    setLanguage(nextLanguage);
    window.dispatchEvent(new Event('focusmate:language-changed'));
  };

  return (
    <div className="public-site" dir={textDirection(language)}>
      <a className="public-skip-link" href="#main-content">
        {translate(language, 'public.skipToContent')}
      </a>
      <PublicHeader language={language} onLanguageChange={changeLanguage} />
      <main id="main-content" className={page === 'contact' ? 'public-main public-main-contact' : 'public-main'}>
        {page === 'about' && <AboutContent />}
        {page === 'privacy' && <PrivacyContent />}
        {page === 'contact' && <div className="public-content"><ContactPage language={language} /></div>}
        {page === 'not-found' && <NotFoundContent />}
      </main>
      <footer className="public-footer">
        <a href="/about">{translate(language, 'public.about')}</a>
        <a href="/privacy">{translate(language, 'public.privacy')}</a>
        <a href="/contact">{translate(language, 'public.contact')}</a>
        <span>© FocusMate</span>
      </footer>
    </div>
  );
}
