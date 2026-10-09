const SESSION_ACTIVITY_EVENT = 'focusmate:pwa-session-activity';

export function reportPwaSessionActivity(source, active) {
  window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT, {
    detail: { source, active: Boolean(active) },
  }));
}

export { SESSION_ACTIVITY_EVENT };
