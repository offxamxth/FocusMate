const { randomUUID } = require('node:crypto');

const SUPPORT_EMAIL = 'support.focusmate@gmail.com';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 1_500_000;
const ISSUES = new Set([
  'General Question',
  'Technical Problem',
  'Camera / Webcam',
  'Focus Session',
  'Profile / Login',
  'XP / Progress',
  'Achievements',
  'Feedback',
  'Other',
]);

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a valid JSON object.');
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) {
      const error = new Error('The submission is too large. Screenshots must be 1 MB or smaller.');
      error.status = 413;
      throw error;
    }
    return body;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let oversized = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES && !oversized) {
        oversized = true;
        const error = new Error('The submission is too large. Screenshots must be 1 MB or smaller.');
        error.status = 413;
        reject(error);
      }
      if (!oversized) chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a valid JSON object.');
        resolve(body);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, name, { required = false, min = 0, max = 5000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  const text = value.trim();
  if (required && text.length < min) throw new Error(`${name} must be at least ${min} characters.`);
  if (text.length > max) throw new Error(`${name} must be ${max} characters or fewer.`);
  return text;
}

function validateUsername(value) {
  const username = cleanText(value, 'Username', { max: 32 }).replace(/^@/, '').toLowerCase();
  if (username && !/^[a-z0-9_.-]{1,32}$/.test(username)) {
    throw new Error('Username may contain only letters, numbers, dots, dashes, and underscores.');
  }
  return username;
}

function validateEmail(value) {
  const email = cleanText(value, 'Email', { required: true, max: 254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

function validateScreenshot(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid screenshot.');
  const name = cleanText(value.name, 'Screenshot filename', { required: true, max: 160 });
  const type = cleanText(value.type, 'Screenshot type', { required: true, max: 40 });
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
    throw new Error('Screenshots must be PNG, JPG, or WEBP images.');
  }
  const data = cleanText(value.data, 'Screenshot data', { required: true, max: 2_000_000 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error('The screenshot data is invalid.');
  }
  const bytes = Buffer.from(data, 'base64');
  const declaredSize = Number(value.size);
  if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES || declaredSize !== bytes.length) {
    throw new Error('Screenshots must be non-empty and 1 MB or smaller.');
  }
  const signatureValid = type === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!signatureValid) throw new Error('The selected file does not match its image type.');
  const safeName = name.split(/[\\/]/).pop().replace(/[^\w.-]/g, '_').slice(0, 100);
  return { filename: safeName, content: bytes.toString('base64') };
}

function validateSubmission(body) {
  if (cleanText(body.website, 'Website', { max: 200 })) throw new Error('Submission rejected.');

  const type = cleanText(body.type, 'Submission type', { required: true, max: 20 });
  const username = validateUsername(body.username);
  const browser = cleanText(body.browser, 'Browser', { max: 120 });
  const device = cleanText(body.device, 'Device', { max: 120 });
  const screenshot = validateScreenshot(body.screenshot);

  if (type === 'contact') {
    const email = validateEmail(body.email);
    const issue = cleanText(body.issue, 'Issue', { required: true, max: 50 });
    if (!ISSUES.has(issue)) throw new Error('Choose a valid issue.');
    const description = cleanText(body.description, 'Description', { required: true, min: 3, max: 5000 });
    return { type, username, browser, device, screenshot, email, issue, description };
  }

  if (type === 'bug') {
    const description = cleanText(body.description, 'What happened', { required: true, min: 3, max: 2000 });
    const steps = cleanText(body.steps, 'What you were doing', { required: true, min: 3, max: 5000 });
    const errorMessage = cleanText(body.errorMessage, 'Error message', { max: 2000 });
    return { type, username, browser, device, screenshot, description, steps, errorMessage };
  }

  if (type === 'feedback') {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5.');
    const feedback = cleanText(body.feedback, 'Feedback', { required: true, min: 3, max: 3000 });
    const improvementSuggestion = cleanText(body.improvementSuggestion, 'Improvement suggestion', { max: 3000 });
    if (screenshot) throw new Error('Screenshots are supported only for contact messages and bug reports.');
    return { type, username, browser, device, rating, feedback, improvementSuggestion };
  }

  throw new Error('Choose a valid submission type.');
}

function emailContent(submission, id, createdAt) {
  const lines = [
    `Submission ID: ${id}`,
    `Type: ${submission.type}`,
    `Status: new`,
    `Received: ${createdAt}`,
    `Username: ${submission.username ? `@${submission.username}` : 'Not provided'}`,
  ];

  if (submission.email) lines.push(`Reply-to email: ${submission.email}`);
  if (submission.issue) lines.push(`Issue: ${submission.issue}`);
  if (submission.description) lines.push('', submission.type === 'bug' ? 'What happened:' : 'Description:', submission.description);
  if (submission.steps) lines.push('', 'What the user was doing:', submission.steps);
  if (submission.errorMessage) lines.push('', 'Error message:', submission.errorMessage);
  if (submission.rating !== undefined) lines.push(`Rating: ${submission.rating}/5`);
  if (submission.feedback) lines.push('', 'Feedback:', submission.feedback);
  if (submission.improvementSuggestion) lines.push('', 'Improvement suggestion:', submission.improvementSuggestion);
  if (submission.browser) lines.push(`Browser: ${submission.browser}`);
  if (submission.device) lines.push(`Device: ${submission.device}`);
  if (submission.screenshot) lines.push(`Screenshot attached: ${submission.screenshot.filename}`);
  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Use POST to submit a support message.' });
  }
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return respond(res, 415, { error: 'Send the form as JSON.' });
  }

  let submission;
  try {
    const body = await readJsonBody(req);
    submission = validateSubmission(body);
  } catch (error) {
    return respond(res, error.status || 400, { error: error.message || 'The submission is invalid.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SUPPORT_FROM_EMAIL;
  if (!apiKey || !from) {
    return respond(res, 503, {
      error: 'Online support submissions are not configured yet. Please email support.focusmate@gmail.com instead.',
    });
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const title = submission.type === 'bug'
    ? 'Bug report'
    : submission.type === 'feedback'
      ? 'Feedback'
      : 'Contact message';
  const subject = `[FocusMate ${title}] ${submission.issue || 'New submission'}`.slice(0, 180);
  const email = {
    from,
    to: [SUPPORT_EMAIL],
    subject,
    text: emailContent(submission, id, createdAt),
    ...(submission.email ? { reply_to: submission.email } : {}),
    ...(submission.screenshot ? { attachments: [submission.screenshot] } : {}),
  };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return respond(res, 502, { error: 'The support email service could not accept your message. Please try again or email Technical Support.' });
    }
    const result = await response.json().catch(() => ({}));
    if (typeof result.id !== 'string' || !result.id) {
      return respond(res, 502, { error: 'The support email service returned an unexpected response. Please try again or email Technical Support.' });
    }
    return respond(res, 200, { ok: true, id: result.id });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    return respond(res, timedOut ? 504 : 502, {
      error: timedOut
        ? 'The support email service timed out. Please try again or email Technical Support.'
        : 'The support email service is unavailable. Please try again or email Technical Support.',
    });
  }
};
