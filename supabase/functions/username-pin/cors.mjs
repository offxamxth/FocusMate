const allowedOrigins = new Set([
  'https://getfocusmate.vercel.app',
  'https://focus-mate-fph9wppxm-cyb3r-amxths-projects.vercel.app',
  'https://focus-mate-i7a2lyrcv-cyb3r-amxths-projects.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export function isUsernamePinOriginAllowed(origin) {
  return Boolean(origin && allowedOrigins.has(origin));
}
