import { useRef, useState } from 'react';
import { version as appVersion } from '../package.json';
import { submitSupportForm } from './support-submissions.js';
import {
  AlertTriangle, ArrowUpRight, Bug, CheckCircle2, CircleHelp, Lightbulb,
  Mail, MessageSquareText, Send, ShieldAlert, Upload,
} from 'lucide-react';

const SUPPORT_EMAIL = 'support.focusmate@gmail.com';
const ISSUE_OPTIONS = [
  'General Question',
  'Technical Problem',
  'Camera / Webcam',
  'Focus Session',
  'Profile / Login',
  'XP / Progress',
  'Achievements',
  'Feedback',
  'Other',
];

function environmentDetails() {
  const userAgent = navigator.userAgent || '';
  let browser = 'Unknown browser';
  if (/Edg\//i.test(userAgent)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(userAgent)) browser = 'Opera';
  else if (/Firefox\//i.test(userAgent)) browser = 'Firefox';
  else if (/Chrome\//i.test(userAgent)) browser = 'Chrome';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';
  const device = navigator.userAgentData?.platform || navigator.platform || 'Unknown device';
  return { browser, device };
}

function AlertMessage({ message }) {
  if (!message) return null;
  const SuccessIcon = message.kind === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`contact-alert ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      <SuccessIcon size={17} aria-hidden="true" />
      <p>{message.text}</p>
    </div>
  );
}

function ScreenshotField({ id, file, onChange, disabled }) {
  const chooseFile = (event) => {
    const nextFile = event.target.files?.[0] || null;
    onChange(nextFile);
  };

  return (
    <div className="contact-field screenshot-field">
      <label htmlFor={id}>Screenshot <span>(optional; not sent with this form)</span></label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        onChange={chooseFile}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
      />
      <small id={`${id}-hint`} className="field-hint">Web3Forms does not send this selected image. To share it, attach it to an email to {SUPPORT_EMAIL}.</small>
      {file && <small className="field-hint selected-file"><Upload size={13} /> Selected locally: {file.name}</small>}
    </div>
  );
}

function Honeypot({ value, onChange }) {
  return (
    <label className="contact-honeypot" aria-hidden="true">
      Leave this field empty
      <input name="botcheck" tabIndex={-1} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default function ContactPage({ username }) {
  const [contact, setContact] = useState({ email: '', issue: '', description: '', screenshot: null });
  const [bug, setBug] = useState({ happened: '', steps: '', errorMessage: '', screenshot: null });
  const [feedback, setFeedback] = useState({ rating: '', feedback: '', improvementSuggestion: '' });
  const [messages, setMessages] = useState({});
  const [submitting, setSubmitting] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const submissionLock = useRef(false);

  const usernameValue = String(username || '').trim().replace(/^@/, '');
  const mailtoBody = [
    `Username: ${usernameValue ? `@${usernameValue}` : 'Not available'}`,
    'Problem:',
    '',
    `Browser: ${environmentDetails().browser}`,
    `Device: ${environmentDetails().device}`,
    `FocusMate version: ${appVersion}`,
  ].join('\n');
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('FocusMate Technical Support')}&body=${encodeURIComponent(mailtoBody)}`;

  const send = async (event, type, values, reset) => {
    event.preventDefault();
    if (submissionLock.current) return;

    if (honeypot) {
      setMessages((current) => ({ ...current, [type]: { kind: 'error', text: 'We couldn’t submit your message. Please try again or use Technical Support.' } }));
      return;
    }

    submissionLock.current = true;
    setSubmitting(type);
    setMessages((current) => ({ ...current, [type]: null }));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);
    try {
      const { browser, device } = environmentDetails();
      await submitSupportForm({
        ...values,
        username: usernameValue,
        browser,
        device,
        appVersion,
        botcheck: honeypot,
      }, {
        accessKey: import.meta.env.VITE_WEB3FORMS_ACCESS_KEY,
        signal: controller.signal,
      });

      reset();
      setMessages((current) => ({
        ...current,
        [type]: { kind: 'success', text: 'Web3Forms accepted your message for delivery to FocusMate Support. Thank you for helping us improve.' },
      }));
    } catch (error) {
      const text = error.name === 'AbortError'
        ? 'The request timed out. Please try again or use Technical Support.'
        : error instanceof TypeError
          ? 'We couldn’t reach the support service. Please try again or use Technical Support.'
          : error.message || 'We couldn’t submit your message. Please try again or use Technical Support.';
      setMessages((current) => ({ ...current, [type]: { kind: 'error', text } }));
    } finally {
      window.clearTimeout(timeout);
      submissionLock.current = false;
      setSubmitting('');
    }
  };

  const updateContact = (field, value) => setContact((current) => ({ ...current, [field]: value }));
  const updateBug = (field, value) => setBug((current) => ({ ...current, [field]: value }));
  const updateFeedback = (field, value) => setFeedback((current) => ({ ...current, [field]: value }));
  const disabled = Boolean(submitting);

  return (
    <div className="page-content contact-page">
      <section className="contact-intro">
        <div className="contact-intro-copy">
          <span className="eyebrow">CONTACT &amp; SUPPORT</span>
          <h2>Need a hand with FocusMate?</h2>
          <p>Get help with a technical problem, report a bug, or share an idea. We’re here to help you make room for your best work.</p>
          <div className="contact-shortcuts" aria-label="Jump to a support section">
            <a href="#technical-support"><Mail size={15} /> Technical support</a>
            <a href="#contact-form"><MessageSquareText size={15} /> Contact us</a>
            <a href="#bug-report"><Bug size={15} /> Report a bug</a>
            <a href="#send-feedback"><Lightbulb size={15} /> Send feedback</a>
          </div>
        </div>
        <div className="contact-intro-mark" aria-hidden="true"><CircleHelp size={39} /><span>WE’RE<br />LISTENING</span></div>
      </section>

      <section className="surface-panel contact-support-card" id="technical-support" aria-labelledby="technical-support-title">
        <div className="contact-card-icon"><ShieldAlert size={19} /></div>
        <div className="contact-support-copy">
          <span className="eyebrow">DIRECT EMAIL</span>
          <h2 id="technical-support-title">Technical Support</h2>
          <p>Having trouble with FocusMate? Tell us what’s going on and we’ll help you troubleshoot.</p>
          <a className="support-email" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <a className="primary-button contact-email-button" href={mailto}>Email Technical Support <ArrowUpRight size={16} /></a>
          <small className="field-hint">Your email app will open with a draft addressed to Support. Nothing is sent automatically. If it doesn’t open, copy the email address above into your email app.</small>
        </div>
      </section>

      <div className="contact-forms-grid">
        <section className="surface-panel contact-form-panel" id="contact-form" aria-labelledby="contact-form-title">
          <div className="section-heading">
            <div><span className="eyebrow">GET IN TOUCH</span><h2 id="contact-form-title"><MessageSquareText size={18} /> Contact FocusMate</h2></div>
          </div>
          <form onSubmit={(event) => {
            const description = contact.description.trim();
            if (!contact.email.trim() || !contact.issue || description.length < 3) {
              event.preventDefault();
              setMessages((current) => ({ ...current, contact: { kind: 'error', text: 'Enter a valid email, choose an issue, and write at least 3 characters in your message.' } }));
              return;
            }
            void send(event, 'contact', { type: 'contact', email: contact.email.trim(), issue: contact.issue, description, screenshot: contact.screenshot }, () => {
              setContact({ email: '', issue: '', description: '', screenshot: null });
              const input = document.getElementById('contact-screenshot');
              if (input) input.value = '';
            });
          }}>
            <Honeypot value={honeypot} onChange={setHoneypot} />
            <div className="contact-field">
              <label htmlFor="contact-username">Username</label>
              <input id="contact-username" value={usernameValue ? `@${usernameValue}` : 'Not available'} readOnly />
              <small className="field-hint">From the active local profile</small>
            </div>
            <div className="contact-field">
              <label htmlFor="contact-email">Email <span>(required)</span></label>
              <input id="contact-email" type="email" autoComplete="email" maxLength={254} required value={contact.email} onChange={(event) => updateContact('email', event.target.value)} placeholder="you@example.com" disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="contact-issue">Issue <span>(required)</span></label>
              <select id="contact-issue" required value={contact.issue} onChange={(event) => updateContact('issue', event.target.value)} disabled={disabled}>
                <option value="">Select an issue</option>
                {ISSUE_OPTIONS.map((issue) => <option key={issue} value={issue}>{issue}</option>)}
              </select>
            </div>
            <div className="contact-field">
              <label htmlFor="contact-description">Description <span>(required)</span></label>
              <textarea id="contact-description" required minLength={3} maxLength={5000} rows={5} value={contact.description} onChange={(event) => updateContact('description', event.target.value)} placeholder="How can we help?" disabled={disabled} />
              <small className="field-hint">{contact.description.length}/5000 characters</small>
            </div>
            <ScreenshotField id="contact-screenshot" file={contact.screenshot} onChange={(file) => updateContact('screenshot', file)} disabled={disabled} />
            <AlertMessage message={messages.contact} />
            <button className="primary-button contact-submit" type="submit" disabled={disabled}>{submitting === 'contact' ? 'Submitting…' : 'Submit'} <Send size={15} /></button>
          </form>
        </section>

        <section className="surface-panel contact-form-panel" id="bug-report" aria-labelledby="bug-report-title">
          <div className="section-heading">
            <div><span className="eyebrow">HELP US FIX IT</span><h2 id="bug-report-title"><Bug size={18} /> Report a Bug</h2></div>
          </div>
          <form onSubmit={(event) => {
            if (bug.happened.trim().length < 3 || bug.steps.trim().length < 3) {
              event.preventDefault();
              setMessages((current) => ({ ...current, bug: { kind: 'error', text: 'Describe what happened and what you were doing (at least 3 characters each).' } }));
              return;
            }
            void send(event, 'bug', {
              type: 'bug',
              description: bug.happened.trim(),
              steps: bug.steps.trim(),
              errorMessage: bug.errorMessage.trim(),
              screenshot: bug.screenshot,
            }, () => {
              setBug({ happened: '', steps: '', errorMessage: '', screenshot: null });
              const input = document.getElementById('bug-screenshot');
              if (input) input.value = '';
            });
          }}>
            <Honeypot value={honeypot} onChange={setHoneypot} />
            <div className="contact-field">
              <label htmlFor="bug-happened">What happened? <span>(required)</span></label>
              <textarea id="bug-happened" required minLength={3} maxLength={2000} rows={3} value={bug.happened} onChange={(event) => updateBug('happened', event.target.value)} placeholder="Describe the problem you saw." disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="bug-steps">What were you doing? <span>(required)</span></label>
              <textarea id="bug-steps" required minLength={3} maxLength={5000} rows={3} value={bug.steps} onChange={(event) => updateBug('steps', event.target.value)} placeholder="What did you click or do just before it happened?" disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="bug-error">Error message <span>(optional)</span></label>
              <textarea id="bug-error" maxLength={2000} rows={2} value={bug.errorMessage} onChange={(event) => updateBug('errorMessage', event.target.value)} placeholder="Paste any error text you saw." disabled={disabled} />
            </div>
            <ScreenshotField id="bug-screenshot" file={bug.screenshot} onChange={(file) => updateBug('screenshot', file)} disabled={disabled} />
            <AlertMessage message={messages.bug} />
            <button className="primary-button contact-submit" type="submit" disabled={disabled}>{submitting === 'bug' ? 'Submitting…' : 'Submit Bug Report'} <Send size={15} /></button>
          </form>
        </section>

        <section className="surface-panel contact-form-panel feedback-panel" id="send-feedback" aria-labelledby="feedback-title">
          <div className="section-heading">
            <div><span className="eyebrow">IDEAS ARE ALWAYS WELCOME</span><h2 id="feedback-title"><Lightbulb size={18} /> Send Feedback</h2></div>
          </div>
          <form onSubmit={(event) => {
            if (!feedback.rating || feedback.feedback.trim().length < 3) {
              event.preventDefault();
              setMessages((current) => ({ ...current, feedback: { kind: 'error', text: 'Choose a rating and share at least 3 characters of feedback.' } }));
              return;
            }
            void send(event, 'feedback', {
              type: 'feedback',
              rating: Number(feedback.rating),
              feedback: feedback.feedback.trim(),
              improvementSuggestion: feedback.improvementSuggestion.trim(),
            }, () => setFeedback({ rating: '', feedback: '', improvementSuggestion: '' }));
          }}>
            <Honeypot value={honeypot} onChange={setHoneypot} />
            <fieldset className="contact-rating" disabled={disabled}>
              <legend>How was your experience? <span>(required)</span></legend>
              <div className="rating-options">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <label className={feedback.rating === String(rating) ? 'selected' : ''} key={rating}>
                    <input type="radio" name="experience-rating" value={rating} required checked={feedback.rating === String(rating)} onChange={(event) => updateFeedback('rating', event.target.value)} aria-label={`${rating} out of 5 stars`} />
                    <span aria-hidden="true">⭐ {rating}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="contact-field">
              <label htmlFor="feedback-text">What do you think? <span>(required)</span></label>
              <textarea id="feedback-text" required minLength={3} maxLength={3000} rows={4} value={feedback.feedback} onChange={(event) => updateFeedback('feedback', event.target.value)} placeholder="What has your experience been like?" disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="feedback-improve">What would you like us to improve? <span>(optional)</span></label>
              <textarea id="feedback-improve" maxLength={3000} rows={3} value={feedback.improvementSuggestion} onChange={(event) => updateFeedback('improvementSuggestion', event.target.value)} placeholder="Share a feature idea or something we could make better." disabled={disabled} />
            </div>
            <AlertMessage message={messages.feedback} />
            <button className="primary-button contact-submit" type="submit" disabled={disabled}>{submitting === 'feedback' ? 'Submitting…' : 'Send Feedback'} <Send size={15} /></button>
          </form>
        </section>
      </div>

      <aside className="contact-privacy-note">
        <ShieldAlert size={17} aria-hidden="true" />
        <p><strong>Before you send:</strong> Please don’t include passwords, payment information, or other sensitive details. When online support is configured, form messages are sent through Web3Forms to the inbox associated with the access key. Screenshots selected here are not sent; attach them to an email to {SUPPORT_EMAIL}. FocusMate does not save submissions in a FocusMate database. If the service is unavailable, the form will show an error; email support remains available above.</p>
      </aside>

      <section className="contact-faq" aria-labelledby="faq-title">
        <div className="section-heading">
          <div><span className="eyebrow">A FEW QUICK ANSWERS</span><h2 id="faq-title"><CircleHelp size={18} /> FAQ / Help Center</h2></div>
        </div>
        <div className="faq-list">
          <details><summary>How do I start a FocusMate session?</summary><p>Go to the Focus Room and select Start Session. Allow camera permission if you choose to use optional webcam monitoring. Timer-only study sessions work without a camera.</p></details>
          <details><summary>Why isn’t my webcam working?</summary><p>Check that your browser has camera permission, another application is not using the camera, the correct camera is selected, and the page is allowed to access it. Webcam monitoring needs a secure page (HTTPS or localhost). If the problem continues, contact Technical Support or Report a Bug.</p></details>
          <details><summary>Why isn’t my focus score updating?</summary><p>FocusMate shows estimated observable camera signals, not a focus score. Make sure optional webcam monitoring is running and the face and posture detection components have loaded. Signals can remain unknown if your face or shoulders aren’t visible.</p></details>
          <details><summary>Does FocusMate save my camera video?</summary><p>Camera frames are analyzed in your browser and are not saved or sent to FocusMate’s support service. The app stores derived camera observations, such as posture, distance, and detection events, in the browser-local session data. Webcam monitoring is optional.</p></details>
          <details><summary>Can FocusMate know if I’m actually concentrating?</summary><p>No. FocusMate cannot know what you’re thinking or directly measure true concentration. Optional webcam features estimate observable study-related signals, such as posture, screen distance, and looking-away behavior. Those signals are limited heuristics, not a measure of your thoughts.</p></details>
          <details><summary>Where is my profile stored, and what if I clear browser data?</summary><p>Your profile, progress, preferences, and session history are stored in local browser storage on this device. They are not automatically available on another browser or computer. Clearing this browser’s site data may remove that locally stored information; export a profile backup from Profile &amp; wellbeing before clearing it.</p></details>
          <details><summary>Can I use FocusMate on another computer?</summary><p>You can open FocusMate on another computer, but your local profile and progress do not sync between devices. You would need to create or reopen a profile in that browser; it won’t automatically contain this device’s saved data.</p></details>
          <details><summary>How do I report a problem?</summary><p>Use the Report a Bug form on this page, or email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if the form is unavailable.</p></details>
          <details><summary>How do I send a feature suggestion?</summary><p>Use the Send Feedback form on this page to share your experience and ideas for improvement.</p></details>
        </div>
      </section>
    </div>
  );
}
