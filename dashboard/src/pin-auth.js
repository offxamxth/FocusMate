import { authErrorMessage } from './lib/supabase.js';

export function validatePinAccount({ username, displayName = '', pin, action }) {
  if (action !== 'migrate' && !String(username || '').trim()) return 'Please enter your username.';
  if (action === 'signup' && !String(displayName || '').trim()) return 'Please enter your display name.';
  if (!/^\d{6}$/.test(String(pin || ''))) return 'Enter exactly 6 digits for your PIN.';
  return '';
}

export async function authenticateWithUsernamePin(client, credentials) {
  const { data, error } = await client.functions.invoke('username-pin', {
    body: {
      action: credentials.action,
      username: (credentials.username || '').trim().toLowerCase(),
      displayName: credentials.displayName?.trim(),
      language: credentials.language,
      ...(credentials.email ? { email: credentials.email.trim() } : {}),
      ...(credentials.currentPassword ? { currentPassword: credentials.currentPassword } : {}),
      pin: credentials.pin,
    },
  });
  if (error) {
    let responseData = data;
    if (!responseData && error.context && typeof error.context.json === 'function') {
      try {
        responseData = await error.context.json();
      } catch {
        responseData = null;
      }
    }
    const responseMessage = responseData?.error || error.message;
    throw new Error(authErrorMessage(new Error(responseMessage)));
  }
  if (!data?.session?.access_token || !data?.session?.refresh_token) {
    throw new Error('FocusMate could not create a secure session. Please try again.');
  }
  const { data: sessionData, error: sessionError } = await client.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError) throw new Error(authErrorMessage(sessionError));
  if (!sessionData.session) throw new Error('FocusMate could not restore your secure session. Please try again.');
  return sessionData.session;
}
