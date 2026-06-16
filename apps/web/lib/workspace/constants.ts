// Shared by client (writes the cookie on switch) and server (reads it to resolve
// the active workspace for SSR). Kept dependency-free so both runtimes can import.

export const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

// Persist the selection for a year; it is a non-sensitive UI preference.
export const ACTIVE_WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
