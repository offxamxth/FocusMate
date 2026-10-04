const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';
const SUPPORT_EMAIL = 'support.focusmate@gmail.com';

const FORM_DETAILS = {
  contact: {
    name: 'Contact Us',
    subject: (submission) => `Contact Us${submission.issue ? `: ${submission.issue}` : ''}`,
  },
  bug: {
    name: 'Bug Report',
    subject: () => 'Bug Report',
  },
  feedback: {
    name: 'Feedback',
    subject: () => 'Feedback',
  },
};

function createPayload(submission, accessKey) {
  const form = FORM_DETAILS[submission.type];
  if (!form || typeof form.subject !== 'function') throw new Error('Choose a valid support form.');

  const username = submission.username ? `@${submission.username.replace(/^@/, '')}` : 'Not provided';
  const lines = [
    `Form type: ${form.name}`,
    `Username: ${username}`,
  ];
  const payload = {
    access_key: accessKey,
    subject: `[FocusMate] ${form.subject(submission)}`,
    from_name: `FocusMate ${form.name}`,
    form_type: form.name,
    username,
    browser: submission.browser,
    device: submission.device,
    app_version: submission.appVersion,
    botcheck: submission.botcheck,
  };

  if (submission.type === 'contact') {
    payload.email = submission.email;
    payload.issue = submission.issue;
    payload.description = submission.description;
    lines.push(`Reply email: ${submission.email}`, `Issue: ${submission.issue}`, '', submission.description);
  } else if (submission.type === 'bug') {
    payload.what_happened = submission.description;
    payload.steps = submission.steps;
    payload.error_message = submission.errorMessage;
    lines.push(`What happened: ${submission.description}`, `What they were doing: ${submission.steps}`);
    if (submission.errorMessage) lines.push(`Error message: ${submission.errorMessage}`);
  } else {
    payload.rating = `${submission.rating}/5`;
    payload.feedback = submission.feedback;
    payload.improvement_suggestion = submission.improvementSuggestion;
    lines.push(`Rating: ${submission.rating}/5`, '', submission.feedback);
    if (submission.improvementSuggestion) lines.push('', 'Improvement suggestion:', submission.improvementSuggestion);
  }

  lines.push('', `Browser: ${submission.browser}`, `Device: ${submission.device}`, `FocusMate version: ${submission.appVersion}`);
  payload.message = lines.join('\n');
  return payload;
}

export async function submitSupportForm(submission, { accessKey, signal, fetchImpl = fetch }) {
  if (!accessKey?.trim()) {
    throw new Error(`Support forms are not configured. Set VITE_WEB3FORMS_ACCESS_KEY in dashboard/.env or in the Vercel project environment variables, then restart or redeploy. You can also email ${SUPPORT_EMAIL}.`);
  }

  const response = await fetchImpl(WEB3FORMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(createPayload(submission, accessKey.trim())),
    signal,
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The support service returned an unexpected response. Please try again or use Technical Support.');
  }

  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.message === 'string' && result.message
      ? `Web3Forms couldn’t accept your message: ${result.message}`
      : 'Web3Forms couldn’t accept your message. Please try again or use Technical Support.');
  }
}
