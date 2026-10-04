import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  authenticateWithUsernamePin,
  isUsernameUnavailableMessage,
  validatePinAccount,
} from '../src/pin-auth.js';
import { achievementCatalog } from '../src/achievement-data.js';
import { supportedLanguages, translate, translateAchievement } from '../src/i18n.js';

test('PIN validation accepts exactly six ASCII digits', () => {
  assert.equal(validatePinAccount({ username: 'reader', displayName: 'Reader', pin: '012345', action: 'signup' }), '');
  for (const pin of ['12345', '1234567', '12 456', '12a456', '１２３４５６', '']) {
    assert.equal(
      validatePinAccount({ username: 'reader', displayName: 'Reader', pin, action: 'signup' }),
      'Enter exactly 6 digits for your PIN.',
      `expected ${JSON.stringify(pin)} to be rejected`,
    );
  }
});

test('PIN validation requires a username and signup display name', () => {
  assert.equal(validatePinAccount({ username: ' ', pin: '123456', action: 'login' }), 'Please enter your username.');
  assert.equal(validatePinAccount({ username: 'reader', displayName: ' ', pin: '123456', action: 'signup' }), 'Please enter your display name.');
  assert.equal(validatePinAccount({ username: '', pin: '123456', action: 'migrate' }), '');
});

test('only the explicit username-conflict response is treated as username unavailable', () => {
  assert.equal(isUsernameUnavailableMessage('That username is unavailable. Choose another username.'), true);
  assert.equal(isUsernameUnavailableMessage('Account creation is temporarily unavailable. Please try again later.'), false);
  assert.equal(isUsernameUnavailableMessage('Account creation is temporarily limited. Please try again later.'), false);
  assert.equal(isUsernameUnavailableMessage('Database service unavailable.'), false);
});

test('username/PIN auth sends the PIN only to the auth function and installs its session', async () => {
  const invoked = [];
  const installed = [];
  const client = {
    functions: {
      invoke: async (...args) => {
        invoked.push(args);
        return { data: { session: { access_token: 'access', refresh_token: 'refresh' } }, error: null };
      },
    },
    auth: {
      setSession: async (tokens) => {
        installed.push(tokens);
        return { data: { session: { user: { id: 'user-id' } } }, error: null };
      },
    },
  };

  const session = await authenticateWithUsernamePin(client, {
    action: 'signup',
    username: 'Reader',
    displayName: 'Focus reader',
    language: 'fr',
    pin: '012345',
  });

  assert.deepEqual(invoked[0], ['username-pin', {
    body: {
      action: 'signup',
      username: 'reader',
      displayName: 'Focus reader',
      language: 'fr',
      pin: '012345',
    },
  }]);
  assert.deepEqual(installed, [{ access_token: 'access', refresh_token: 'refresh' }]);
  assert.equal(session.user.id, 'user-id');
});

test('existing account migration sends the old credentials only to the auth function', async () => {
  let requestBody;
  const client = {
    functions: {
      invoke: async (_name, options) => {
        requestBody = options.body;
        return { data: { session: { access_token: 'access', refresh_token: 'refresh' } }, error: null };
      },
    },
    auth: {
      setSession: async () => ({ data: { session: { user: { id: 'migrated-user' } } }, error: null }),
    },
  };

  await authenticateWithUsernamePin(client, {
    action: 'migrate',
    username: '',
    email: 'Reader@example.com',
    currentPassword: 'legacy-password',
    language: 'en',
    pin: '012345',
  });

  assert.deepEqual(requestBody, {
    action: 'migrate',
    username: '',
    displayName: undefined,
    language: 'en',
    email: 'Reader@example.com',
    currentPassword: 'legacy-password',
    pin: '012345',
  });
});

test('newly translated account and profile UI has all five language values', () => {
  for (const language of supportedLanguages) {
    for (const key of [
      'auth.username', 'auth.pin', 'auth.migrateTitle', 'nav.overview',
      'heading.focusTitle', 'profile.cloudData', 'contact.title',
      'contact.faqStorageCloud', 'preferences.settingsTitle',
      'focus.taskTitle', 'insights.completedSessions',
      'results.waiting', 'achievements.collection',
      'results.suggestion.posture', 'results.suggestion.screen_distance',
      'results.suggestion.looking_away', 'results.suggestion.fatigue_related',
      'achievements.group.Study habits', 'achievements.group.Goals & reflection',
    ]) {
      assert.notEqual(translate(language, key), key, `${language} is missing ${key}`);
    }
  }
});

test('every achievement has localized titles and descriptions in all supported languages', () => {
  for (const language of supportedLanguages) {
    for (const [id, title, description] of achievementCatalog) {
      const translatedTitle = translateAchievement(language, id, 'title', title);
      const translatedDescription = translateAchievement(language, id, 'description', description);
      assert.ok(translatedTitle, `${language} is missing achievement title ${id}`);
      assert.ok(translatedDescription, `${language} is missing achievement description ${id}`);
      if (language !== 'en') {
        assert.notEqual(translatedTitle, title, `${language} has an English title for ${id}`);
        assert.notEqual(translatedDescription, description, `${language} has an English description for ${id}`);
      }
    }
  }
});

test('every visible contact form string is translated in all supported languages', async () => {
  const source = await readFile(new URL('../src/ContactPage.jsx', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\('([^']+)'/g)].map((match) => `contact.${match[1]}`);
  for (const issue of [
    'General Question', 'Technical Problem', 'Camera / Webcam', 'Focus Session',
    'Profile / Login', 'XP / Progress', 'Achievements', 'Feedback', 'Other',
  ]) keys.push(`contact.issue.${issue}`);
  for (const language of supportedLanguages) {
    for (const key of new Set(keys)) {
      assert.notEqual(translate(language, key), key, `${language} is missing ${key}`);
    }
  }
});

test('PIN migration database objects are inaccessible to browser roles', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004140000_username_pin_auth.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /create table if not exists private\.pin_credentials/i);
  assert.match(sql, /create table if not exists private\.pin_login_limits/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table private\.pin_credentials, private\.pin_login_limits\s+from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.register_focusmate_pin[\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.register_focusmate_pin[\s\S]*?to service_role/i);
  assert.match(sql, /check \(jsonb_typeof\(app_data\) = 'object'\)/i);
  assert.match(sql, /foreach v_key_hash in array p_key_hashes/i);
  assert.match(sql, /where limits\.key_hash = v_key_hash/i);
  assert.doesNotMatch(sql, /where limits\.key_hash = key_hash/i);
});

test('username/PIN function logs sanitized error details and missing setting names only', async () => {
  const source = await readFile(
    new URL('../../supabase/functions/username-pin/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /function logSafeRequestError\(error: unknown, sensitiveValues: string\[\]\)/);
  assert.match(source, /replaceAll\(sensitiveValue, "\[REDACTED\]"\)/);
  assert.match(source, /errorMessage: safeMessage/);
  assert.match(source, /missingEnvironmentVariables/);
  assert.match(source, /"https:\/\/getfocusmate\.vercel\.app"/);
  assert.match(source, /"Access-Control-Allow-Methods": "POST, OPTIONS"/);
  assert.match(source, /"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"/);
  assert.match(source, /new Response\("ok", \{ status: 200, headers: corsHeadersFor\(request\) \}\)/);
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin":\s*"\*"/);
  assert.doesNotMatch(
    source,
    /console\.error\(\s*(?:body|pin|currentPassword|serviceRoleKey|publishableKey|pinPepper)\b/i,
  );
  assert.match(source, /async function usernameIsRegistered\(username: string\)/);
  assert.match(source, /const \{ data, error \} = await admin!\.rpc\(\s*"find_focusmate_user_by_username"/);
  assert.match(source, /if \(await usernameIsRegistered\(username\)\) \{\s*return response\(409/);
  assert.match(source, /if \(error\) throw error;\s*throw new Error\("Supabase Auth did not return a user during signup\."\)/);
  assert.match(source, /Account creation is temporarily limited/);
});

test('Focus Score UI has been removed while local legacy-data sanitizing stays private to storage', async () => {
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const contact = await readFile(new URL('../src/ContactPage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /focus score|focus_score/i);
  assert.doesNotMatch(contact, /focus score|focus_score/i);
});
