const pageAliases = {
  tasks: 'overview',
  focus: 'focus-room',
  rooms: 'focus-room',
};

const knownPages = new Set([
  'overview',
  'focus-room',
  'friends',
  'leaderboard',
  'insights',
  'session-results',
  'achievements',
  'quests',
  'session-preferences',
  'profile',
  'contact',
]);

const publicPaths = new Map([
  ['/about', 'about'],
  ['/contact', 'contact'],
  ['/privacy', 'privacy'],
]);

export function publicPageFromLocation(location) {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  return publicPaths.get(pathname) || null;
}

export function isUnknownPath(location) {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  return pathname !== '/'
    && pathname !== '/index.html'
    && !publicPaths.has(pathname);
}

export function pageFromLocation(location) {
  const publicPage = publicPageFromLocation(location);
  if (publicPage) return publicPage;
  const destination = location.hash.slice(1);
  const page = pageAliases[destination] || destination;
  return knownPages.has(page) ? page : 'overview';
}

export function mobileDestinationFromLocation(location) {
  const destination = location.hash.slice(1);
  if (['overview', 'tasks', 'focus', 'rooms', 'profile'].includes(destination)) {
    return destination;
  }
  if (destination === 'focus-room') return 'focus';
  return knownPages.has(destination) ? destination : 'overview';
}

export function navigationPath(destination) {
  return destination === 'about' || destination === 'privacy'
    ? `/${destination}`
    : `/#${destination}`;
}
