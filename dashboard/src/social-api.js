const genericSocialError = 'Something went wrong. Please try again.';

function socialErrorMessage(error, operation) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();

  if (code === '28000') return 'Sign in again to use FocusMate social features.';
  if (code === 'P0002') {
    if (operation === 'search') return '';
    if (operation === 'send') return 'No FocusMate account was found with that username.';
    if (operation === 'respond' || operation === 'cancel') return 'That friend request is no longer available.';
    return 'That friendship is no longer available.';
  }
  if (code === '22023') {
    if (message.includes('yourself')) return 'You cannot add yourself as a friend.';
    return 'Enter a valid FocusMate username.';
  }
  if (code === '23505') return 'A friend request or friendship already exists.';
  if (code === '42501') return 'You are not allowed to perform that action.';
  if (/fetch failed|failed to fetch|network|connection|timeout/.test(message) || error instanceof TypeError) {
    return 'Network error. Check your connection and try again.';
  }
  return genericSocialError;
}

async function invokeSocialRpc(client, name, args, operation) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(socialErrorMessage(error, operation));
  return data;
}

export async function searchFocusMateUser(client, username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,32}$/.test(normalized)) {
    throw new Error('Enter a valid FocusMate username.');
  }
  const rows = await invokeSocialRpc(
    client,
    'search_focusmate_users',
    { p_username: normalized },
    'search',
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function listFocusMateFriends(client) {
  const rows = await invokeSocialRpc(client, 'list_focusmate_friends', {}, 'list');
  return Array.isArray(rows) ? rows : [];
}

export async function listFocusMateFriendRequests(client) {
  const rows = await invokeSocialRpc(client, 'list_focusmate_friend_requests', {}, 'list');
  return Array.isArray(rows) ? rows : [];
}

export async function sendFocusMateFriendRequest(client, username) {
  const normalized = String(username || '').trim().toLowerCase();
  const rows = await invokeSocialRpc(
    client,
    'send_focusmate_friend_request',
    { p_username: normalized },
    'send',
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export function respondToFocusMateFriendRequest(client, requestId, accept) {
  return invokeSocialRpc(
    client,
    'respond_focusmate_friend_request',
    { p_request_id: requestId, p_accept: accept },
    'respond',
  );
}

export function cancelFocusMateFriendRequest(client, requestId) {
  return invokeSocialRpc(
    client,
    'cancel_focusmate_friend_request',
    { p_request_id: requestId },
    'cancel',
  );
}

export function removeFocusMateFriend(client, friendId) {
  return invokeSocialRpc(
    client,
    'remove_focusmate_friend',
    { p_friend_id: friendId },
    'remove',
  );
}
