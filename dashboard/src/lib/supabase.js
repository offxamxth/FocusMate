import { createClient } from '@supabase/supabase-js';

const environment = import.meta.env || {};
const supabaseUrl = environment.VITE_SUPABASE_URL || '';
const supabasePublishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY || '';

function tokenRole(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return '';
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return typeof payload.role === 'string' ? payload.role : '';
  } catch {
    return '';
  }
}

export function supabaseConfigurationIssue(url, publishableKey) {
  const missing = [];
  if (!String(url || '').trim()) missing.push('VITE_SUPABASE_URL');
  if (!String(publishableKey || '').trim()) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (missing.length) {
    return `Cloud sign-in is unavailable: set ${missing.join(' and ')} in dashboard/.env.local or the Vercel build environment.`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return 'Cloud sign-in is unavailable: VITE_SUPABASE_URL must be a valid HTTPS URL.';
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && localHost)) {
    return 'Cloud sign-in is unavailable: VITE_SUPABASE_URL must use HTTPS (except for local development).';
  }
  const key = String(publishableKey).trim();
  const role = tokenRole(key);
  if (key.startsWith('sb_secret_') || role === 'service_role') {
    return 'Cloud sign-in is unavailable: never use a Supabase secret or service-role key in the browser; use the project publishable key.';
  }
  if (/replace_with_your_project_key/i.test(key)) {
    return 'Cloud sign-in is unavailable: replace the example value of VITE_SUPABASE_PUBLISHABLE_KEY with the project publishable key.';
  }
  if (!key.startsWith('sb_publishable_')) {
    return 'Cloud sign-in is unavailable: VITE_SUPABASE_PUBLISHABLE_KEY must contain the project publishable key.';
  }
  return '';
}

export const supabaseConfigurationError = supabaseConfigurationIssue(
  supabaseUrl,
  supabasePublishableKey,
);
export const supabaseConfigured = !supabaseConfigurationError;
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

export function validCloudUsername(value) {
  return /^[a-z0-9_.-]{1,32}$/.test(String(value || '').trim().toLowerCase());
}

export function localIdentityForAuthUser(userId) {
  const compactId = String(userId || '').replaceAll('-', '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compactId)) {
    throw new Error('The authenticated account has an invalid ID.');
  }
  return `cloud_${compactId}`;
}

export function authErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (code === '23505' || /duplicate key|username.*(taken|already)|profiles_username/i.test(message)) {
    return 'That username is already taken. Choose another username.';
  }
  if (/invalid login credentials|email not confirmed|password/.test(message)) {
    return 'Authentication could not be completed.';
  }
  if (/fetch failed|failed to fetch|network|connection|timeout/.test(message) || error instanceof TypeError) {
    return 'Network error — please check your connection and try again.';
  }
  return error?.message || 'FocusMate could not complete that request. Please try again.';
}

export async function getPrivateProfile(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('id, user_id, username, display_name, xp, level, achievements, preferences, study_goal, theme, study_style, time_format, session_preferences, app_data, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('Your cloud profile is not available yet. Check that the FocusMate database migration has been applied.');
  }
  return data;
}

export async function updatePrivateProfile(client, userId, change) {
  const payload = {};
  if (Object.hasOwn(change, 'player_name')) payload.display_name = String(change.player_name || '').trim().slice(0, 80);
  if (Object.hasOwn(change, 'app_data')) {
    if (!change.app_data || typeof change.app_data !== 'object' || Array.isArray(change.app_data)) {
      throw new Error('Cloud profile data must be an object.');
    }
    payload.app_data = change.app_data;
  }
  if (!change.session_preferences || typeof change.session_preferences !== 'object') {
    if (!Object.keys(payload).length) return null;
  } else {
    const preferences = change.session_preferences;
    for (const [key, value] of [
      ['study_goal', preferences.study_goal_type],
      ['theme', preferences.theme],
      ['study_style', preferences.study_style],
      ['time_format', preferences.time_format],
    ]) {
      if (value !== undefined) payload[key] = value;
    }
    payload.session_preferences = Object.fromEntries(
      Object.entries(preferences).filter(([key]) =>
        !['study_goal_type', 'theme', 'study_style', 'time_format'].includes(key),
      ),
    );
    payload.preferences = {
      ...payload.session_preferences,
      study_goal_type: preferences.study_goal_type,
      theme: preferences.theme,
      study_style: preferences.study_style,
      time_format: preferences.time_format,
    };
  }
  if (!Object.keys(payload).length) return null;

  const { data, error } = await client
    .from('profiles')
    .update(payload)
    .eq('user_id', userId)
    .select('id, user_id, username, display_name, xp, level, achievements, preferences, study_goal, theme, study_style, time_format, session_preferences, app_data, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}
