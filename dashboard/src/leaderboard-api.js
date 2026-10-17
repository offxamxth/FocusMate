const allowedScopes = new Set(['global', 'friends']);
const allowedVisibilities = new Set(['private', 'friends', 'public']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nullablePositiveInteger(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 1);
}

function levelMatchesXp(xp, level) {
  return Number.isSafeInteger(level) && level === Math.floor(xp / 100) + 1;
}

function leaderboardError(code, message) {
  const error = new Error(message);
  error.code = String(code || '');
  return error;
}

function assertLeaderboardClient(client) {
  if (!client || typeof client.rpc !== 'function') {
    throw leaderboardError('28000', 'Authentication is required to load the leaderboard.');
  }
}

function normalizeLeaderboard(data) {
  if (!isRecord(data) || !Array.isArray(data.entries) || !isRecord(data.progress)) {
    throw leaderboardError('INVALID_RESPONSE', 'The leaderboard response was invalid.');
  }

  const entries = data.entries.map((entry) => {
    if (!isRecord(entry)
      || !Number.isSafeInteger(entry.rank)
      || entry.rank < 1
      || typeof entry.username !== 'string'
      || typeof entry.display_name !== 'string'
      || !nonNegativeInteger(entry.global_xp)
      || !levelMatchesXp(entry.global_xp, entry.level)) {
      throw leaderboardError('INVALID_RESPONSE', 'The leaderboard response was invalid.');
    }
    return {
      rank: Number(entry.rank),
      username: entry.username,
      display_name: entry.display_name,
      global_xp: Number(entry.global_xp),
      level: Number(entry.level),
    };
  });

  const progress = data.progress;
  if (!nonNegativeInteger(progress.global_xp)
    || !levelMatchesXp(progress.global_xp, progress.level)
    || !Object.hasOwn(progress, 'rank')
    || !nullablePositiveInteger(progress.rank)
    || !allowedVisibilities.has(progress.visibility)
    || typeof progress.listed !== 'boolean'
    || !allowedScopes.has(data.scope)
    || typeof data.has_more !== 'boolean'
    || !nonNegativeInteger(data.total_entries)) {
    throw leaderboardError('INVALID_RESPONSE', 'The leaderboard response was invalid.');
  }

  return {
    scope: data.scope,
    entries,
    has_more: data.has_more,
    total_entries: data.total_entries,
    progress: {
      global_xp: progress.global_xp,
      level: progress.level,
      rank: progress.rank,
      visibility: progress.visibility,
      listed: progress.listed,
    },
  };
}

export async function getFocusMateLeaderboard(
  client,
  { scope = 'global', limit = 20, offset = 0 } = {},
) {
  assertLeaderboardClient(client);

  if (!allowedScopes.has(scope)
    || !Number.isInteger(limit) || limit < 1 || limit > 50
    || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw leaderboardError('22023', 'The leaderboard request was invalid.');
  }

  const { data, error } = await client.rpc('get_focusmate_leaderboard', {
    p_scope: scope,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw leaderboardError(error.code, 'The leaderboard could not be loaded.');
  return normalizeLeaderboard(data);
}

export async function setFocusMateLeaderboardVisibility(client, visibility) {
  assertLeaderboardClient(client);

  if (!allowedVisibilities.has(visibility)) {
    throw leaderboardError('22023', 'The leaderboard privacy setting was invalid.');
  }
  const { data, error } = await client.rpc('set_focusmate_leaderboard_visibility', {
    p_visibility: visibility,
  });
  if (error) throw leaderboardError(error.code, 'The leaderboard privacy setting could not be saved.');
  if (!allowedVisibilities.has(data)) {
    throw leaderboardError('INVALID_RESPONSE', 'The leaderboard privacy response was invalid.');
  }
  return data;
}

export function leaderboardErrorTranslationKey(error) {
  const code = String(error?.code || '');
  if (code === '28000') return 'leaderboard.error.signIn';
  if (code === '22023') return 'leaderboard.error.request';
  if (code === '42501') return 'leaderboard.error.forbidden';
  if (code === 'INVALID_RESPONSE') return 'leaderboard.error.response';
  if (error instanceof TypeError || /fetch failed|failed to fetch|network|connection|timeout/i.test(error?.message || '')) {
    return 'leaderboard.error.network';
  }
  return 'leaderboard.error.generic';
}
