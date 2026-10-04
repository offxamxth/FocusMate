import { useRef, useState } from 'react';
import { version as appVersion } from '../package.json';
import { submitSupportForm } from './support-submissions.js';
import { translate } from './i18n.js';
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

function ScreenshotField({ id, file, onChange, disabled, t }) {
  const chooseFile = (event) => {
    const nextFile = event.target.files?.[0] || null;
    onChange(nextFile);
  };

  return (
    <div className="contact-field screenshot-field">
      <label htmlFor={id}>{t('screenshot')} <span>({t('optionalNotSent')})</span></label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        onChange={chooseFile}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
      />
      <small id={`${id}-hint`} className="field-hint">{t('screenshotHint')} {SUPPORT_EMAIL}</small>
      {file && <small className="field-hint selected-file"><Upload size={13} /> {t('selectedLocally')}: {file.name}</small>}
    </div>
  );
}

function Honeypot({ value, onChange, t }) {
  return (
    <label className="contact-honeypot" aria-hidden="true">
      {t('honeypot')}
      <input name="botcheck" tabIndex={-1} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default function ContactPage({ username, language = 'en', accountType = 'local' }) {
  const [contact, setContact] = useState({ email: '', issue: '', description: '', screenshot: null });
  const [bug, setBug] = useState({ happened: '', steps: '', errorMessage: '', screenshot: null });
  const [feedback, setFeedback] = useState({ rating: '', feedback: '', improvementSuggestion: '' });
  const [messages, setMessages] = useState({});
  const [submitting, setSubmitting] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const submissionLock = useRef(false);
  const t = (key, values) => translate(language, `contact.${key}`, values);

  const usernameValue = String(username || '').trim().replace(/^@/, '');
  const mailtoBody = [
    `Username: ${usernameValue ? `@${usernameValue}` : 'Not available'}`,
    t('emailProblem'),
    '',
    `${t('browser')}: ${environmentDetails().browser}`,
    `${t('device')}: ${environmentDetails().device}`,
    `${t('version')}: ${appVersion}`,
  ].join('\n');
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('technicalSupport'))}&body=${encodeURIComponent(mailtoBody)}`;

  const send = async (event, type, values, reset) => {
    event.preventDefault();
    if (submissionLock.current) return;

    if (honeypot) {
      setMessages((current) => ({ ...current, [type]: { kind: 'error', text: t('submitError') } }));
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
        [type]: { kind: 'success', text: t('submitSuccess') },
      }));
    } catch (error) {
      const text = error.name === 'AbortError'
        ? t('timeout')
        : error instanceof TypeError
          ? t('networkError')
          : error.message || t('submitError');
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
          <span className="eyebrow">{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
          <p>{t('intro')}</p>
          <div className="contact-shortcuts" aria-label={t('shortcuts')}>
            <a href="#technical-support"><Mail size={15} /> {t('technicalSupport')}</a>
            <a href="#contact-form"><MessageSquareText size={15} /> {t('contactUs')}</a>
            <a href="#bug-report"><Bug size={15} /> {t('reportBug')}</a>
            <a href="#send-feedback"><Lightbulb size={15} /> {t('sendFeedback')}</a>
          </div>
        </div>
        <div className="contact-intro-mark" aria-hidden="true"><CircleHelp size={39} /><span style={{ whiteSpace: 'pre-line' }}>{t('listening')}</span></div>
      </section>

      <section className="surface-panel contact-support-card" id="technical-support" aria-labelledby="technical-support-title">
        <div className="contact-card-icon"><ShieldAlert size={19} /></div>
        <div className="contact-support-copy">
          <span className="eyebrow">{t('directEmail')}</span>
          <h2 id="technical-support-title">{t('technicalSupport')}</h2>
          <p>{t('supportDescription')}</p>
          <a className="support-email" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <a className="primary-button contact-email-button" href={mailto}>{t('emailSupport')} <ArrowUpRight size={16} /></a>
          <small className="field-hint">{t('mailtoHelp')}</small>
        </div>
      </section>

      <div className="contact-forms-grid">
        <section className="surface-panel contact-form-panel" id="contact-form" aria-labelledby="contact-form-title">
          <div className="section-heading">
            <div><span className="eyebrow">{t('getInTouch')}</span><h2 id="contact-form-title"><MessageSquareText size={18} /> {t('contactUs')}</h2></div>
          </div>
          <form onSubmit={(event) => {
            const description = contact.description.trim();
            if (!contact.email.trim() || !contact.issue || description.length < 3) {
              event.preventDefault();
              setMessages((current) => ({ ...current, contact: { kind: 'error', text: t('contactValidation') } }));
              return;
            }
            void send(event, 'contact', { type: 'contact', email: contact.email.trim(), issue: contact.issue, description, screenshot: contact.screenshot }, () => {
              setContact({ email: '', issue: '', description: '', screenshot: null });
              const input = document.getElementById('contact-screenshot');
              if (input) input.value = '';
            });
          }}>
              <Honeypot value={honeypot} onChange={setHoneypot} t={t} />
            <div className="contact-field">
                <label htmlFor="contact-username">{t('username')}</label>
                <input id="contact-username" value={usernameValue ? `@${usernameValue}` : t('notAvailable')} readOnly />
                <small className="field-hint">{t('activeProfile')}</small>
            </div>
            <div className="contact-field">
                <label htmlFor="contact-email">{t('email')} <span>({t('required')})</span></label>
                <input id="contact-email" type="email" autoComplete="email" maxLength={254} required value={contact.email} onChange={(event) => updateContact('email', event.target.value)} placeholder={t('emailPlaceholder')} disabled={disabled} />
            </div>
            <div className="contact-field">
                <label htmlFor="contact-issue">{t('issue')} <span>({t('required')})</span></label>
              <select id="contact-issue" required value={contact.issue} onChange={(event) => updateContact('issue', event.target.value)} disabled={disabled}>
                  <option value="">{t('selectIssue')}</option>
                  {ISSUE_OPTIONS.map((issue) => <option key={issue} value={issue}>{t(`issue.${issue}`)}</option>)}
              </select>
            </div>
            <div className="contact-field">
                <label htmlFor="contact-description">{t('description')} <span>({t('required')})</span></label>
                <textarea id="contact-description" required minLength={3} maxLength={5000} rows={5} value={contact.description} onChange={(event) => updateContact('description', event.target.value)} placeholder={t('contactPlaceholder')} disabled={disabled} />
                <small className="field-hint">{t('characters', { count: contact.description.length })}</small>
            </div>
              <ScreenshotField id="contact-screenshot" file={contact.screenshot} onChange={(file) => updateContact('screenshot', file)} disabled={disabled} t={t} />
            <AlertMessage message={messages.contact} />
              <button className="primary-button contact-submit" type="submit" disabled={disabled}>{submitting === 'contact' ? t('submitting') : t('submit')} <Send size={15} /></button>
          </form>
        </section>

        <section className="surface-panel contact-form-panel" id="bug-report" aria-labelledby="bug-report-title">
          <div className="section-heading">
            <div><span className="eyebrow">{t('bugEyebrow')}</span><h2 id="bug-report-title"><Bug size={18} /> {t('reportBug')}</h2></div>
          </div>
          <form onSubmit={(event) => {
            if (bug.happened.trim().length < 3 || bug.steps.trim().length < 3) {
              event.preventDefault();
              setMessages((current) => ({ ...current, bug: { kind: 'error', text: t('bugValidation') } }));
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
            <Honeypot value={honeypot} onChange={setHoneypot} t={t} />
            <div className="contact-field">
              <label htmlFor="bug-happened">{t('whatHappened')} <span>({t('required')})</span></label>
              <textarea id="bug-happened" required minLength={3} maxLength={2000} rows={3} value={bug.happened} onChange={(event) => updateBug('happened', event.target.value)} placeholder={t('whatHappenedPlaceholder')} disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="bug-steps">{t('whatDoing')} <span>({t('required')})</span></label>
              <textarea id="bug-steps" required minLength={3} maxLength={5000} rows={3} value={bug.steps} onChange={(event) => updateBug('steps', event.target.value)} placeholder={t('whatDoingPlaceholder')} disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="bug-error">{t('errorMessage')} <span>({t('optional')})</span></label>
              <textarea id="bug-error" maxLength={2000} rows={2} value={bug.errorMessage} onChange={(event) => updateBug('errorMessage', event.target.value)} placeholder={t('errorPlaceholder')} disabled={disabled} />
            </div>
            <ScreenshotField id="bug-screenshot" file={bug.screenshot} onChange={(file) => updateBug('screenshot', file)} disabled={disabled} t={t} />
            <AlertMessage message={messages.bug} />
            <button className="primary-button contact-submit" type="submit" disabled={disabled}>{submitting === 'bug' ? t('submitting') : t('submitBug')} <Send size={15} /></button>
          </form>
        </section>

        <section className="surface-panel contact-form-panel feedback-panel" id="send-feedback" aria-labelledby="feedback-title">
          <div className="section-heading">
            <div><span className="eyebrow">{t('feedbackEyebrow')}</span><h2 id="feedback-title"><Lightbulb size={18} /> {t('sendFeedback')}</h2></div>
          </div>
          <form onSubmit={(event) => {
            if (!feedback.rating || feedback.feedback.trim().length < 3) {
              event.preventDefault();
              setMessages((current) => ({ ...current, feedback: { kind: 'error', text: t('feedbackValidation') } }));
              return;
            }
            void send(event, 'feedback', {
              type: 'feedback',
              rating: Number(feedback.rating),
              feedback: feedback.feedback.trim(),
              improvementSuggestion: feedback.improvementSuggestion.trim(),
            }, () => setFeedback({ rating: '', feedback: '', improvementSuggestion: '' }));
          }}>
            <Honeypot value={honeypot} onChange={setHoneypot} t={t} />
            <fieldset className="contact-rating" disabled={disabled}>
              <legend>{t('rating')} <span>({t('required')})</span></legend>
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
              <label htmlFor="feedback-text">{t('whatThink')} <span>({t('required')})</span></label>
              <textarea id="feedback-text" required minLength={3} maxLength={3000} rows={4} value={feedback.feedback} onChange={(event) => updateFeedback('feedback', event.target.value)} placeholder={t('feedbackPlaceholder')} disabled={disabled} />
            </div>
            <div className="contact-field">
              <label htmlFor="feedback-improve">{t('improvement')} <span>({t('optional')})</span></label>
              <textarea id="feedback-improve" maxLength={3000} rows={3} value={feedback.improvementSuggestion} onChange={(event) => updateFeedback('improvementSuggestion', event.target.value)} placeholder={t('improvementPlaceholder')} disabled={disabled} />
            </div>
            <AlertMessage message={messages.feedback} />
            <button className="primary-button contact-submit" type="submit" disabled={disabled}>{submitting === 'feedback' ? t('submitting') : t('sendFeedback')} <Send size={15} /></button>
          </form>
        </section>
      </div>

      <aside className="contact-privacy-note">
        <ShieldAlert size={17} aria-hidden="true" />
        <p><strong>{t('beforeSend')}</strong> {t('privacyNote')} {SUPPORT_EMAIL} {t('privacyNoteEnd')}</p>
      </aside>

      <section className="contact-faq" aria-labelledby="faq-title">
        <div className="section-heading">
          <div><span className="eyebrow">{t('faqEyebrow')}</span><h2 id="faq-title"><CircleHelp size={18} /> {t('faqTitle')}</h2></div>
        </div>
        <div className="faq-list">
          <details><summary>{t('faqStartQ')}</summary><p>{t('faqStartA')}</p></details>
          <details><summary>{t('faqCameraQ')}</summary><p>{t('faqCameraA')}</p></details>
          <details><summary>{t('faqSignalQ')}</summary><p>{t('faqSignalA')}</p></details>
          <details><summary>{t('faqVideoQ')}</summary><p>{t('faqVideoA')}</p></details>
          <details><summary>{t('faqConcentrationQ')}</summary><p>{t('faqConcentrationA')}</p></details>
          <details><summary>{t('faqStorageQ')}</summary><p>{accountType === 'cloud' ? t('faqStorageCloud') : t('faqStorageLocal')}</p></details>
          <details><summary>{t('faqDeviceQ')}</summary><p>{accountType === 'cloud' ? t('faqDeviceCloud') : t('faqDeviceLocal')}</p></details>
          <details><summary>{t('faqBugQ')}</summary><p>{t('faqBugA')} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p></details>
          <details><summary>{t('faqFeedbackQ')}</summary><p>{t('faqFeedbackA')}</p></details>
        </div>
      </section>
    </div>
  );
}
