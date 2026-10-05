const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function presenceTopic(userId) {
  if (!uuidPattern.test(String(userId || ''))) {
    throw new Error('Presence is unavailable for this account.');
  }
  return `focusmate-presence:${userId}`;
}

export function startOwnPresence(client, userId, onStatus = () => {}) {
  const topic = presenceTopic(userId);
  let active = true;
  let tracking = false;
  let generation = 0;
  const channel = client.channel(topic, {
    config: { private: true, presence: { key: userId } },
  });
  channel.on('presence', { event: 'sync' }, () => {});

  channel.subscribe(async (status) => {
    if (!active) return;
    if (status !== 'SUBSCRIBED') {
      generation += 1;
      tracking = false;
      onStatus('unavailable');
      return;
    }

    if (tracking) return;
    tracking = true;
    const currentGeneration = ++generation;
    try {
      const result = await channel.track({ status: 'online' });
      if (!active || currentGeneration !== generation) return;
      tracking = result === 'ok';
      onStatus(tracking ? 'online' : 'unavailable');
    } catch {
      if (currentGeneration !== generation) return;
      tracking = false;
      if (active) onStatus('unavailable');
    }
  });

  return () => {
    active = false;
    void client.removeChannel(channel);
  };
}

export function subscribeToFriendPresence(client, userId, friendIds, onChange) {
  const ids = [...new Set(friendIds)]
    .filter((friendId) => friendId !== userId)
    .sort();
  const states = new Map(ids.map((friendId) => [friendId, 'connecting']));
  const channels = [];

  const emit = () => {
    onChange(Object.fromEntries(states));
  };

  for (const friendId of ids) {
    let topic;
    try {
      topic = presenceTopic(friendId);
    } catch {
      states.set(friendId, 'unavailable');
      continue;
    }

    const channel = client.channel(topic, {
      config: { private: true, presence: { key: userId } },
    });
    channels.push(channel);
    channel.on('presence', { event: 'sync' }, () => {
      if (states.get(friendId) === 'unavailable') return;
      const presence = channel.presenceState();
      states.set(friendId, (presence[friendId] || []).length > 0 ? 'online' : 'offline');
      emit();
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const presence = channel.presenceState();
        states.set(friendId, (presence[friendId] || []).length > 0 ? 'online' : 'offline');
      } else {
        states.set(friendId, 'unavailable');
      }
      emit();
    });
  }

  emit();
  return () => {
    for (const channel of channels) void client.removeChannel(channel);
  };
}
