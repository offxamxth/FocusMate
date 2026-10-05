const roomErrors = {
  22023: 'Enter a valid 8-character room code.',
  42900: 'Too many room-code attempts. Please try again later.',
  28000: 'Sign in again to use Focus Rooms.',
  42501: 'You are not a member of this room.',
  54000: 'This room is full or a room code could not be generated.',
  55000: 'This room is closed or you must leave your current room first.',
  P0002: 'No open room was found with that code.',
  generic: 'FocusMate could not complete that room request.',
};

const roomErrorKeys = {
  22023: 'error.invalidCode',
  42900: 'error.rateLimited',
  28000: 'error.signInAgain',
  42501: 'error.notMember',
  54000: 'error.full',
  55000: 'error.unavailable',
  P0002: 'error.notFound',
};

function createRoomError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  const networkError = error instanceof TypeError
    || /fetch failed|failed to fetch|network|connection|timeout/.test(message);
  const roomRequestError = new Error(
    roomErrors[code] || (networkError ? 'Network error. Check your connection and try again.' : roomErrors.generic),
  );
  roomRequestError.code = code;
  return roomRequestError;
}

export function focusRoomErrorTranslationKey(error) {
  const code = String(error?.code || '');
  if (roomErrorKeys[code]) return roomErrorKeys[code];
  const message = String(error?.message || '').toLowerCase();
  if (error instanceof TypeError || /fetch failed|failed to fetch|network|connection|timeout/.test(message)) {
    return 'error.network';
  }
  return 'genericError';
}

async function invokeRoomRpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw createRoomError(error);
  if (data && typeof data === 'object' && data.error) {
    throw createRoomError(data);
  }
  return data;
}

export function createFocusRoom(client) {
  return invokeRoomRpc(client, 'create_focus_room', { p_name: 'Study room' });
}

export function joinFocusRoom(client, roomCode) {
  const code = String(roomCode || '').trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    throw createRoomError({ code: '22023' });
  }
  return invokeRoomRpc(client, 'join_focus_room', { p_room_code: code });
}

export function getMyFocusRoom(client) {
  return invokeRoomRpc(client, 'get_my_focus_room');
}

export function getFocusRoom(client, roomId) {
  return invokeRoomRpc(client, 'get_focus_room', { p_room_id: roomId });
}

export function leaveFocusRoom(client, roomId) {
  return invokeRoomRpc(client, 'leave_focus_room', { p_room_id: roomId });
}

export function startFocusRoomSession(client, roomId, durationSeconds) {
  return invokeRoomRpc(client, 'start_focus_room_session', {
    p_room_id: roomId,
    p_duration_seconds: durationSeconds,
  });
}

export function pauseFocusRoomSession(client, roomId) {
  return invokeRoomRpc(client, 'pause_focus_room_session', { p_room_id: roomId });
}

export function resumeFocusRoomSession(client, roomId) {
  return invokeRoomRpc(client, 'resume_focus_room_session', { p_room_id: roomId });
}

export function startFocusRoomBreak(client, roomId, durationSeconds) {
  return invokeRoomRpc(client, 'start_focus_room_break', {
    p_room_id: roomId,
    p_break_duration_seconds: durationSeconds,
  });
}

export function finishFocusRoomSession(client, roomId) {
  return invokeRoomRpc(client, 'finish_focus_room_session', { p_room_id: roomId });
}

export function subscribeToFocusRoom(client, room, userId, handlers) {
  const channel = client.channel(`focusmate-room:${room.id}`, {
    config: { private: true, presence: { key: userId } },
  });
  let active = true;
  let tracking = false;
  let generation = 0;

  const emitPresence = () => {
    if (!active) return;
    const current = channel.presenceState();
    handlers.onPresence(Object.fromEntries(Object.keys(current).map((userId) => [userId, 'online'])));
  };

  channel
    .on('presence', { event: 'sync' }, emitPresence)
    .on('presence', { event: 'join' }, emitPresence)
    .on('presence', { event: 'leave' }, emitPresence)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'focus_room_members',
      filter: `room_id=eq.${room.id}`,
    }, handlers.onRoomChange)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'focus_rooms',
      filter: `id=eq.${room.id}`,
    }, handlers.onRoomChange)
    .subscribe(async (status) => {
      if (!active) return;
      if (status !== 'SUBSCRIBED') {
        generation += 1;
        tracking = false;
        handlers.onConnection(status === 'CLOSED' ? 'offline' : 'unavailable');
        return;
      }
      if (tracking) return;
      tracking = true;
      const currentGeneration = ++generation;
      handlers.onConnection('connecting');
      try {
        const result = await channel.track({ status: 'online' });
        if (!active || currentGeneration !== generation) return;
        tracking = result === 'ok';
        handlers.onConnection(tracking ? 'online' : 'unavailable');
        if (tracking) {
          emitPresence();
          handlers.onRoomChange();
        }
      } catch {
        if (!active || currentGeneration !== generation) return;
        tracking = false;
        handlers.onConnection('unavailable');
      }
    });

  return () => {
    active = false;
    void client.removeChannel(channel);
  };
}
