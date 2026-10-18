import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2.19.1";
import { isUsernamePinOriginAllowed } from "../username-pin/cors.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const liveKitUrl = Deno.env.get("LIVEKIT_URL") || "";
const liveKitApiKey = Deno.env.get("LIVEKIT_API_KEY") || "";
const liveKitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") || "";
const roomIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedRoomStates = ["waiting", "focusing", "paused", "break"];

function corsHeadersFor(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (isUsernamePinOriginAllowed(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function respond(request: Request, status: number, body: Record<string, string>) {
  const headers = corsHeadersFor(request);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function providerConfigurationReady() {
  if (!supabaseUrl || !publishableKey || !liveKitUrl || !liveKitApiKey || !liveKitApiSecret) {
    return false;
  }
  try {
    return new URL(liveKitUrl).protocol === "wss:";
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(request) });
  }
  if (request.method !== "POST") {
    return respond(request, 405, { error: "METHOD_NOT_ALLOWED" });
  }
  if (!providerConfigurationReady()) {
    return respond(request, 503, { error: "VIDEO_PROVIDER_NOT_CONFIGURED" });
  }

  const authorization = request.headers.get("authorization") || "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearerToken) {
    return respond(request, 401, { error: "AUTHENTICATION_REQUIRED" });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(request, 400, { error: "INVALID_REQUEST" });
  }
  const roomId = payload && typeof payload === "object" && "room_id" in payload
    ? payload.room_id
    : null;
  if (typeof roomId !== "string" || !roomIdPattern.test(roomId)) {
    return respond(request, 400, { error: "INVALID_REQUEST" });
  }

  try {
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(bearerToken);
    const user = userData.user;
    if (authError || !user) {
      return respond(request, 401, { error: "AUTHENTICATION_REQUIRED" });
    }

    const { data: membership, error: membershipError } = await userClient
      .from("focus_room_members")
      .select("room_id")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle();
    if (membershipError) throw membershipError;

    const { data: room, error: roomError } = await userClient
      .from("focus_rooms")
      .select("id, state")
      .eq("id", roomId)
      .in("state", allowedRoomStates)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!membership || !room) {
      return respond(request, 403, { error: "ROOM_MEMBERSHIP_REQUIRED" });
    }

    const accessToken = new AccessToken(liveKitApiKey, liveKitApiSecret, {
      identity: user.id,
      ttl: "15m",
    });
    accessToken.addGrant({
      room: `focusmate-${roomId}`,
      roomJoin: true,
      canPublish: true,
      canPublishSources: ["camera", "microphone"],
      canPublishData: false,
      canSubscribe: true,
    });
    const token = await accessToken.toJwt();
    return respond(request, 200, { url: liveKitUrl, token });
  } catch (error) {
    console.error("Focus Room video token issuance failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return respond(request, 500, { error: "VIDEO_TOKEN_REQUEST_FAILED" });
  }
});
