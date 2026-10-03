import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../api/support-submissions.js';

function invoke(body, { method = 'POST', contentType = 'application/json' } = {}) {
  const headers = {};
  const response = {
    statusCode: 0,
    headers,
    body: '',
    setHeader(name, value) { headers[name] = value; },
    end(value) { this.body = value; },
  };
  const request = { method, headers: { 'content-type': contentType }, body };
  return handler(request, response).then(() => ({
    status: response.statusCode,
    headers,
    body: response.body ? JSON.parse(response.body) : null,
  }));
}

async function withSupportConfig(run, fetchStub) {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.SUPPORT_FROM_EMAIL;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.SUPPORT_FROM_EMAIL = 'FocusMate <support@example.test>';
  globalThis.fetch = (...args) => {
    globalThis.fetch.mock.calls.push({ arguments: args });
    return fetchStub(...args);
  };
  globalThis.fetch.mock = { calls: [] };
  try {
    return await run();
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.SUPPORT_FROM_EMAIL;
    else process.env.SUPPORT_FROM_EMAIL = previousFrom;
    globalThis.fetch = previousFetch;
  }
}

test('valid contact submission is sent to the fixed support inbox', async () => {
  await withSupportConfig(async () => {
    const result = await invoke({
      type: 'contact',
      username: '@study.friend-1',
      email: 'student@example.com',
      issue: 'Camera / Webcam',
      description: 'My camera permission prompt does not appear.',
      browser: 'Firefox',
      device: 'Windows',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, id: 'email-123' });
    assert.equal(globalThis.fetch.mock.calls.length, 1);
    const sent = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
    assert.deepEqual(sent.to, ['support.focusmate@gmail.com']);
    assert.equal(sent.reply_to, 'student@example.com');
    assert.match(sent.text, /Username: @study\.friend-1/);
    assert.match(sent.text, /Status: new/);
  }, async (_url, options) => {
    assert.match(options.headers.Authorization, /^Bearer test-key$/);
    return { ok: true, json: async () => ({ id: 'email-123' }) };
  });
});

test('bug reports require context and forward a validated screenshot attachment', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  await withSupportConfig(async () => {
    const result = await invoke({
      type: 'bug',
      username: 'focus.friend',
      description: 'The session timer froze.',
      steps: 'I started a session and changed tabs.',
      errorMessage: '',
      screenshot: { name: 'timer.png', type: 'image/png', size: png.length, data: png.toString('base64') },
    });
    assert.equal(result.status, 200);
    const sent = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
    assert.equal(sent.attachments[0].filename, 'timer.png');
    assert.equal(sent.attachments[0].content, png.toString('base64'));
    assert.match(sent.text, /What the user was doing:/);
  }, async () => ({ ok: true, json: async () => ({ id: 'bug-123' }) }));
});

test('feedback requires a rating and sends the suggestion to support', async () => {
  await withSupportConfig(async () => {
    const result = await invoke({
      type: 'feedback',
      username: 'focusfriend',
      rating: 5,
      feedback: 'The calm dashboard helps me get started.',
      improvementSuggestion: 'A weekly calendar would be useful.',
    });
    assert.equal(result.status, 200);
    const sent = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
    assert.match(sent.text, /Rating: 5\/5/);
    assert.match(sent.text, /A weekly calendar would be useful/);
  }, async () => ({ ok: true, json: async () => ({ id: 'feedback-123' }) }));
});

test('invalid input, non-JSON requests, and missing service configuration never report success', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.SUPPORT_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.SUPPORT_FROM_EMAIL;
  try {
    const invalidEmail = await invoke({
      type: 'contact', email: 'not-an-email', issue: 'Other', description: 'I need help.',
    });
    assert.equal(invalidEmail.status, 400);
    assert.match(invalidEmail.body.error, /valid email/i);

    const unsupportedType = await invoke({ type: 'other' });
    assert.equal(unsupportedType.status, 400);

    const notJson = await invoke({}, { contentType: 'text/plain' });
    assert.equal(notJson.status, 415);

    const missingConfiguration = await invoke({
      type: 'contact', email: 'student@example.com', issue: 'Other', description: 'I need help.',
    });
    assert.equal(missingConfiguration.status, 503);
    assert.match(missingConfiguration.body.error, /not configured/i);

    const methodNotAllowed = await invoke({}, { method: 'GET' });
    assert.equal(methodNotAllowed.status, 405);
    assert.equal(methodNotAllowed.headers.Allow, 'POST');
  } finally {
    if (previousKey !== undefined) process.env.RESEND_API_KEY = previousKey;
    if (previousFrom !== undefined) process.env.SUPPORT_FROM_EMAIL = previousFrom;
  }
});

test('spoofed and oversized image uploads are rejected server-side', async () => {
  const spoofed = Buffer.from('not an image').toString('base64');
  const result = await invoke({
    type: 'bug',
    description: 'The button is broken.',
    steps: 'I clicked the start button.',
    screenshot: { name: 'fake.png', type: 'image/png', size: Buffer.from('not an image').length, data: spoofed },
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /does not match/i);

  const oversized = await invoke({
    type: 'bug',
    description: 'The button is broken.',
    steps: 'I clicked the start button.',
    screenshot: {
      name: 'large.png',
      type: 'image/png',
      size: 1024 * 1024 + 1,
      data: Buffer.alloc(1024 * 1024 + 1).toString('base64'),
    },
  });
  assert.equal(oversized.status, 400);
  assert.match(oversized.body.error, /1 MB/i);
});

test('bug, feedback, and honeypot validation reject malformed submissions', async () => {
  const incompleteBug = await invoke({
    type: 'bug',
    description: ' ',
    steps: '',
  });
  assert.equal(incompleteBug.status, 400);

  const invalidRating = await invoke({
    type: 'feedback',
    rating: 6,
    feedback: 'The page is useful.',
  });
  assert.equal(invalidRating.status, 400);
  assert.match(invalidRating.body.error, /rating from 1 to 5/i);

  const spam = await invoke({
    type: 'contact',
    email: 'student@example.com',
    issue: 'Other',
    description: 'Please help me.',
    website: 'https://spam.example',
  });
  assert.equal(spam.status, 400);
  assert.equal(spam.body.error, 'Submission rejected.');
});

test('provider failures return an error rather than a success-shaped fallback', async () => {
  await withSupportConfig(async () => {
    const result = await invoke({
      type: 'contact',
      email: 'student@example.com',
      issue: 'Other',
      description: 'Please help with my account.',
    });
    assert.equal(result.status, 502);
    assert.equal(result.body.ok, undefined);
    assert.match(result.body.error, /could not accept/i);
  }, async () => ({ ok: false, status: 429, json: async () => ({ message: 'rate limited' }) }));
});

test('provider confirmation without an email id is not treated as successful', async () => {
  await withSupportConfig(async () => {
    const result = await invoke({
      type: 'contact',
      email: 'student@example.com',
      issue: 'Other',
      description: 'Please help with my profile.',
    });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, {
      error: 'The support email service returned an unexpected response. Please try again or email Technical Support.',
    });
  }, async () => ({ ok: true, json: async () => ({}) }));
});
