import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const pinIterations = 310_000;
const rateLimitAttempts = 5;
const rateLimitWindowSeconds = 15 * 60;
const usernamePattern = /^[a-z0-9_.-]{1,32}$/;
const supportedLanguages = new Set(["en", "es", "fr", "ar", "hi"]);
const genericLoginMessage = "Incorrect username or PIN.";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const pinPepper = Deno.env.get("FOCUSMATE_PIN_PEPPER") || "";

const admin = projectUrl && serviceRoleKey
  ? createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;
const authClient = projectUrl && publishableKey
  ? createClient(projectUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function validPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function hmacHex(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pinPepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${pin}:${pinPepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    256,
  ));
}

async function authBridgePassword(userId: string, pin: string) {
  return hmacHex(`focusmate-auth-bridge-v1:${userId}:${pin}`);
}

async function authBridgeEmail(username: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`focusmate-internal-auth-v1:${username}`),
  ));
  return `fm-${hex(bytes)}@auth.focusmate.invalid`;
}

async function rateLimitKeys(request: Request, username: string) {
  const forwarded = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return [
    await hmacHex(`username:${username}`),
    await hmacHex(`source:${forwarded}`),
  ];
}

async function consumeRateLimit(
  keys: string[],
  maxAttempts = rateLimitAttempts,
  windowSeconds = rateLimitWindowSeconds,
) {
  const { data, error } = await admin!.rpc("consume_focusmate_pin_attempts", {
    p_key_hashes: keys,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

async function clearRateLimit(keys: string[]) {
  const { error } = await admin!.rpc("clear_focusmate_pin_attempts", { p_key_hashes: keys });
  if (error) throw error;
}

async function issueSession(email: string, password: string) {
  const { data, error } = await authClient!.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error("The account session could not be created.");
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}

async function login(request: Request, username: string, pin: string) {
  const keys = await rateLimitKeys(request, username);
  if (!await consumeRateLimit(keys)) return response(429, { error: genericLoginMessage });

  const { data: users, error: lookupError } = await admin!.rpc(
    "find_focusmate_user_by_username",
    { p_username: username },
  );
  if (lookupError) throw lookupError;
  const user = Array.isArray(users) ? users[0] : null;
  if (!user) return response(401, { error: genericLoginMessage });

  const { data: credentials, error: credentialError } = await admin!.rpc(
    "get_focusmate_pin_credential",
    { p_user_id: user.id },
  );
  if (credentialError) throw credentialError;
  const credential = Array.isArray(credentials) ? credentials[0] : null;
  if (!credential) return response(401, { error: genericLoginMessage });

  const suppliedHash = await derivePinHash(
    pin,
    fromBase64(credential.salt),
    credential.iterations,
  );
  if (!constantTimeEqual(suppliedHash, fromBase64(credential.pin_hash))) {
    return response(401, { error: genericLoginMessage });
  }

  const password = await authBridgePassword(user.id, pin);
  const { data: authUser, error: authUserError } = await admin!.auth.admin.getUserById(user.id);
  if (authUserError) throw authUserError;
  const email = authUser.user?.email || await authBridgeEmail(username);
  const session = await issueSession(email, password);
  await clearRateLimit(keys);
  return response(200, { session });
}

async function migrate(
  request: Request,
  email: string,
  currentPassword: string,
  requestedUsername: string,
  displayName: string,
  language: string,
  pin: string,
) {
  const keys = await rateLimitKeys(request, email);
  if (!await consumeRateLimit(keys)) return response(429, { error: genericLoginMessage });

  const { data: signedIn, error: signInError } = await authClient!.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError || !signedIn.user) return response(401, { error: genericLoginMessage });

  const { data: profile, error: profileError } = await admin!
    .from("profiles")
    .select("id, username, display_name, session_preferences, preferences")
    .eq("id", signedIn.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return response(404, { error: "This account does not have a FocusMate profile to migrate." });

  const username = requestedUsername || profile.username;
  if (!usernamePattern.test(username)) {
    return response(400, { error: "Choose a valid username for your FocusMate account." });
  }

  const { error: profileUpdateError } = await admin!
    .from("profiles")
    .update({
      username,
      session_preferences: { ...(profile.session_preferences || {}), language },
      preferences: { ...(profile.preferences || profile.session_preferences || {}), language },
      ...(displayName ? { display_name: displayName } : {}),
    })
    .eq("id", signedIn.user.id);
  if (profileUpdateError) {
    if (profileUpdateError.code === "23505") {
      return response(409, { error: "That username is unavailable. Choose another username." });
    }
    throw profileUpdateError;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pinHash = await derivePinHash(pin, salt, pinIterations);
  const password = await authBridgePassword(signedIn.user.id, pin);
  const { error: registrationError } = await admin!.rpc("register_focusmate_pin", {
    p_user_id: signedIn.user.id,
    p_salt: toBase64(salt),
    p_pin_hash: toBase64(pinHash),
    p_iterations: pinIterations,
  });
  if (registrationError) throw registrationError;

  const { error: passwordError } = await admin!.auth.admin.updateUserById(signedIn.user.id, { password });
  if (passwordError) throw passwordError;

  const session = await issueSession(email, password);
  await clearRateLimit(keys);
  return response(200, { session });
}

async function signup(username: string, displayName: string, pin: string, language: string) {
  const email = await authBridgeEmail(username);
  const initialPasswordBytes = crypto.getRandomValues(new Uint8Array(32));
  const initialPassword = hex(initialPasswordBytes);
  const { data, error } = await admin!.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: {
      username,
      display_name: displayName,
    },
  });
  if (error || !data.user) {
    return response(409, { error: "That username is unavailable. Choose another username." });
  }

  const userId = data.user.id;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pinHash = await derivePinHash(pin, salt, pinIterations);
    const password = await authBridgePassword(userId, pin);
    const { error: passwordError } = await admin!.auth.admin.updateUserById(userId, { password });
    if (passwordError) throw passwordError;

    const { error: registrationError } = await admin!.rpc("register_focusmate_pin", {
      p_user_id: userId,
      p_salt: toBase64(salt),
      p_pin_hash: toBase64(pinHash),
      p_iterations: pinIterations,
    });
    if (registrationError) throw registrationError;
    const { error: preferenceError } = await admin!
      .from("profiles")
      .update({ session_preferences: { language }, preferences: { language } })
      .eq("id", userId);
    if (preferenceError) throw preferenceError;

    return response(201, { session: await issueSession(email, password) });
  } catch (error) {
    const { error: cleanupError } = await admin!.auth.admin.deleteUser(userId);
    if (cleanupError) console.error("Account setup cleanup failed.");
    console.error("Username/PIN account creation failed.");
    throw error;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });
  if (!admin || !authClient || pinPepper.length < 32) {
    return response(503, { error: "Username/PIN sign-in is not configured yet." });
  }

  try {
    const body = await request.json();
    const action = body?.action;
    const username = normalizeUsername(body?.username);
    const pin = body?.pin;
    if (action !== "migrate" && !usernamePattern.test(username)) {
      return response(400, { error: "Use 1–32 letters, numbers, dots, dashes, or underscores for your username." });
    }
    if (!validPin(pin)) {
      return response(400, { error: "Enter exactly 6 digits for your PIN." });
    }

    if (action === "login") return await login(request, username, pin);
    if (action === "migrate") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const currentPassword = String(body?.currentPassword ?? "");
      const displayName = String(body?.displayName ?? "").trim().slice(0, 80);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !currentPassword) {
        return response(400, { error: "Enter the email and password for your existing account." });
      }
      const language = supportedLanguages.has(body?.language) ? body.language : "en";
      return await migrate(request, email, currentPassword, username, displayName, language, pin);
    }
    if (action !== "signup") return response(400, { error: "Choose log in, create account, or migrate an existing account." });

    const displayName = String(body?.displayName ?? "").trim().slice(0, 80);
    if (!displayName) return response(400, { error: "Please enter your display name." });
    const language = supportedLanguages.has(body?.language) ? body.language : "en";
    const signupSourceKey = await hmacHex(`signup-source:${request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`);
    if (!await consumeRateLimit([signupSourceKey], 8, 60 * 60)) {
      return response(429, { error: "Account creation is temporarily unavailable. Please try again later." });
    }
    return await signup(username, displayName, pin, language);
  } catch {
    console.error("Username/PIN authentication request failed.");
    return response(503, { error: "FocusMate could not complete that request. Please try again." });
  }
});
