const allowedPeriods = new Set(['weekly', 'all_time']);
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

function leaderboardError(code, message) {
  const error = new Error(message);
  error.code = String(code || '');
  return error;
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
      || !nonNegativeInteger(entry.focus_seconds)) {
      throw leaderboardError('INVALID_RESPONSE', 'The leaderboard response was invalid.');
    }
    return {
      rank: Number(entry.rank),
      username: entry.username,
      display_name: entry.display_name,
      focus_seconds: Number(entry.focus_seconds),
    };
  });

  const progress = data.progress;
  if (!nonNegativeInteger(progress.all_time_seconds)
    || !nonNegativeInteger(progress.weekly_seconds)
    || !Object.hasOwn(progress, 'rank')
    || !nullablePositiveInteger(progress.rank)
    || !Object.hasOwn(progress, 'weekly_rank')
    || !nullablePositiveInteger(progress.weekly_rank)
    || !allowedVisibilities.has(progress.visibility)
    || typeof progress.listed !== 'boolean'
    || !allowedPeriods.has(data.period)
    || !allowedScopes.has(data.scope)
    || typeof data.has_more !== 'boolean'
    || !nonNegativeInteger(data.total_entries)
    || typeof data.week_start !== 'string'
    || !Number.isFinite(Date.parse(data.week_start))) {
    throw leaderboardError('INVALID_RESPONSE', 'The leaderboard response was invalid.');
  }

  return {
    period: data.period,
    scope: data.scope,
    week_start: data.week_start,
    entries,
    has_more: data.has_more,
    total_entries: data.total_entries,
    progress: {
      all_time_seconds: progress.all_time_seconds,
      weekly_seconds: progress.weekly_seconds,
      rank: progress.rank,
      weekly_rank: progress.weekly_rank,
      visibility: progress.visibility,
      listed: progress.listed,
    },
  };
}

export async function getFocusMateLeaderboard(
  client,
  { period = 'weekly', scope = 'global', limit = 20, offset = 0 } = {},
) {
  if (!allowedPeriods.has(period) || !allowedScopes.has(scope)
    || !Number.isInteger(limit) || limit < 1 || limit > 50
    || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw leaderboardError('22023', 'The leaderboard request was invalid.');
  }

  const { data, error } = await client.rpc('get_focusmate_leaderboard', {
    p_period: period,
    p_scope: scope,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw leaderboardError(error.code, 'The leaderboard could not be loaded.');
  return normalizeLeaderboard(data);
}

export async function setFocusMateLeaderboardVisibility(client, visibility) {
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
