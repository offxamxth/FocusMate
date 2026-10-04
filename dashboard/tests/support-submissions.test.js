import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submitSupportForm } from '../src/support-submissions.js';

const common = {
  username: 'study.friend',
  browser: 'Firefox',
  device: 'Windows',
  appVersion: '1.0.0',
  botcheck: '',
};

function successfulResponse() {
  return { ok: true, json: async () => ({ success: true, message: 'Email sent successfully.' }) };
}

test('contact, bug, and feedback forms submit Web3Forms-supported subjects and form types', async () => {
  const submissions = [
    {
      ...common,
      type: 'contact',
      email: 'student@example.com',
      issue: 'Camera / Webcam',
      description: 'My camera permission prompt does not appear.',
      screenshot: { name: 'local-only.png' },
    },
    {
      ...common,
      type: 'bug',
      description: 'The session timer froze.',
      steps: 'I started a session and changed tabs.',
      errorMessage: 'Timer paused unexpectedly.',
    },
    {
      ...common,
      type: 'feedback',
      rating: 5,
      feedback: 'The calm dashboard helps me get started.',
      improvementSuggestion: 'A weekly calendar would be useful.',
    },
  ];
  const requests = [];

  for (const submission of submissions) {
    await submitSupportForm(submission, {
      accessKey: 'test-access-key',
      fetchImpl: async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return successfulResponse();
      },
    });
  }

  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(({ url }) => url), Array(3).fill('https://api.web3forms.com/submit'));
  assert.deepEqual(requests.map(({ body }) => body.form_type), ['Contact Us', 'Bug Report', 'Feedback']);
  assert.deepEqual(requests.map(({ body }) => body.subject), [
    '[FocusMate] Contact Us: Camera / Webcam',
    '[FocusMate] Bug Report',
    '[FocusMate] Feedback',
  ]);
  assert.equal(requests[0].body.access_key, 'test-access-key');
  assert.equal(requests[0].body.email, 'student@example.com');
  assert.match(requests[0].body.message, /My camera permission prompt does not appear/);
  assert.match(requests[1].body.message, /I started a session and changed tabs/);
  assert.equal(requests[2].body.rating, '5/5');
  assert.match(requests[2].body.message, /A weekly calendar would be useful/);
  assert.equal('screenshot' in requests[0].body, false);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Accept, 'application/json');
});

test('a missing access key fails clearly without contacting Web3Forms', async () => {
  await assert.rejects(
    submitSupportForm({ ...common, type: 'feedback' }, {
      accessKey: '',
      fetchImpl: async () => assert.fail('fetch should not run without an access key'),
    }),
    /VITE_WEB3FORMS_ACCESS_KEY/,
  );
});

test('API rejections and HTTP errors never resolve as successful submissions', async () => {
  const submission = { ...common, type: 'bug', description: 'Something broke.', steps: 'I clicked start.' };

  await assert.rejects(
    submitSupportForm(submission, {
      accessKey: 'test-access-key',
      fetchImpl: async () => ({ ok: true, json: async () => ({ success: false, message: 'Invalid access key.' }) }),
    }),
    /Invalid access key/,
  );
  await assert.rejects(
    submitSupportForm(submission, {
      accessKey: 'test-access-key',
      fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, message: 'Request rejected.' }) }),
    }),
    /Request rejected/,
  );
});

test('network failures and malformed service responses are surfaced to the form', async () => {
  const submission = { ...common, type: 'feedback', rating: 4, feedback: 'Helpful app.' };
  const networkError = new TypeError('Network unavailable');

  await assert.rejects(
    submitSupportForm(submission, { accessKey: 'test-access-key', fetchImpl: async () => { throw networkError; } }),
    (error) => error === networkError,
  );
  await assert.rejects(
    submitSupportForm(submission, {
      accessKey: 'test-access-key',
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }),
    }),
    /unexpected response/i,
  );
});

test('unsupported form types are rejected before a request is sent', async () => {
  await assert.rejects(
    submitSupportForm({ ...common, type: 'other' }, {
      accessKey: 'test-access-key',
      fetchImpl: async () => assert.fail('fetch should not run for an unsupported form type'),
    }),
    /valid support form/i,
  );
});
