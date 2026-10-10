function progressError(error) {
  const message = String(error?.message || '').toLowerCase();
  const normalized = new Error(
    error?.code === 'P0001' || message.includes('at least 5 verified xp')
      ? 'Earn at least 5 verified room XP before rerolling a quest.'
      : message.includes('could not find the function')
        ? 'Room progress is unavailable until the database update is applied.'
        : 'FocusMate could not update room progress. Please try again.',
  );
  normalized.code = error?.code === 'P0001' ? 'QUEST_REROLL_INSUFFICIENT_XP' : error?.code || '';
  return normalized;
}

async function invokeProgressRpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw progressError(error);
  return data;
}

export function getFocusmateRoomProgress(client) {
  return invokeProgressRpc(client, 'get_focusmate_room_progress');
}

export function rerollFocusmateRoomQuest(client, questId, requestId) {
  return invokeProgressRpc(client, 'reroll_focusmate_room_quest', {
    p_quest_id: questId,
    p_request_id: requestId,
  });
}

export function rerollFocusmateProfileQuest(client, questId, replacementId, requestId) {
  return invokeProgressRpc(client, 'reroll_focusmate_profile_quest', {
    p_quest_id: questId,
    p_replacement_id: replacementId,
    p_request_id: requestId,
  });
}

export function claimFocusmateRoomQuest(client, questId, requestId) {
  return invokeProgressRpc(client, 'claim_focusmate_room_quest', {
    p_quest_id: questId,
    p_request_id: requestId,
  });
}

export function spendFocusmateRoomXp(client, requestId) {
  return invokeProgressRpc(client, 'spend_focusmate_room_xp', {
    p_request_id: requestId,
  });
}

export function publishFocusmateRoomProgress(progress) {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('focusmate:room-progress-updated', {
      detail: progress,
    }));
  }
}
