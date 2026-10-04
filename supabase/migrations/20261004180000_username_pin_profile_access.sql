grant select (id, username, display_name, session_preferences, preferences)
  on table public.profiles to service_role;

grant update (username, display_name, session_preferences, preferences)
  on table public.profiles to service_role;
