const roomIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function videoTokenError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function getFocusRoomVideoToken(client, roomId) {
  if (!client) {
    throw videoTokenError('Focus Room video is unavailable until cloud sign-in is configured.', 'VIDEO_PROVIDER_UNAVAILABLE');
  }
  if (!roomIdPattern.test(String(roomId || ''))) {
    throw videoTokenError('The Focus Room identifier is invalid.', 'VIDEO_REQUEST_INVALID');
  }

  const { data, error } = await client.functions.invoke('focus-room-video-token', {
    body: { room_id: roomId },
  });
  if (error) {
    throw videoTokenError('Focus Room video could not connect to its authorization service.', 'VIDEO_PROVIDER_UNAVAILABLE');
  }
  if (data?.error) {
    const code = String(data.error);
    if (code === 'VIDEO_PROVIDER_NOT_CONFIGURED') {
      throw videoTokenError('Focus Room video is not configured yet.', code);
    }
    if (code === 'ROOM_MEMBERSHIP_REQUIRED') {
      throw videoTokenError('You must be an active member of this room to connect video.', code);
    }
    if (code === 'AUTHENTICATION_REQUIRED') {
      throw videoTokenError('Sign in again to connect Focus Room video.', code);
    }
    throw videoTokenError('Focus Room video could not authorize this connection.', 'VIDEO_PROVIDER_UNAVAILABLE');
  }
  if (typeof data?.url !== 'string' || !/^wss:\/\/[^/\s]+(?:\/.*)?$/i.test(data.url)
    || typeof data?.token !== 'string' || !data.token.trim()) {
    throw videoTokenError('Focus Room video returned an invalid connection response.', 'VIDEO_PROVIDER_UNAVAILABLE');
  }
  return { url: data.url, token: data.token };
}
