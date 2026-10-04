import { createClient } from '@supabase/supabase-js';

const environment = import.meta.env || {};
const supabaseUrl = environment.VITE_SUPABASE_URL || '';
const supabasePublishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
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
  if (/invalid login credentials|invalid email or password/.test(message)) {
    return 'Incorrect email or password.';
  }
  if (/email not confirmed|email_not_confirmed/.test(message)) {
    return 'Please confirm your email before signing in. Check your inbox for the confirmation link.';
  }
  if (/password.*(weak|short|characters)|weak_password/.test(message)) {
    return 'Choose a stronger password that meets the account security requirements.';
  }
  if (/expired|invalid.*(token|link)|otp_expired|access_denied/.test(message)) {
    return 'This link is invalid or expired. Request a new password reset link.';
  }
  if (/fetch failed|failed to fetch|network|connection|timeout/.test(message) || error instanceof TypeError) {
    return 'Network error — please check your connection and try again.';
  }
  return error?.message || 'FocusMate could not complete that request. Please try again.';
}

export async function getPrivateProfile(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('id, username, display_name, study_goal, theme, study_style, time_format, session_preferences, created_at, updated_at')
    .eq('id', userId)
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
  }
  if (!Object.keys(payload).length) return null;

  const { data, error } = await client
    .from('profiles')
    .update(payload)
    .eq('id', userId)
    .select('id, username, display_name, study_goal, theme, study_style, time_format, session_preferences, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}
