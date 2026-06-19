// Internal Unipile wire types. These are PRIVATE to packages/adapters/unipile —
// they must NEVER be exported from the package root (no provider types leak out).
// Shapes are based on Unipile's current API docs (verified June 2026); fields we
// don't rely on are intentionally loose.

export interface UnipileConfig {
  apiKey: string;
  /** DSN host or full URL, e.g. "api49.unipile.com:17977" or with scheme. */
  dsn: string;
}

export interface UnipileAccountListItem {
  object: "Account";
  id: string;
  name?: string;
  type?: string;
  connection_params?: {
    im?: {
      id?: string;
      publicIdentifier?: string;
      username?: string;
    };
  };
  sources?: { id: string; status: string }[];
}

export interface UnipileAccountList {
  object: "AccountList";
  items: UnipileAccountListItem[];
  cursor: string | null;
}

export interface UnipileCreateAccountResponse {
  object: string;
  account_id: string;
}

/** Response of POST /api/v1/hosted/accounts/link — the hosted login URL. */
export interface UnipileHostedAuthResponse {
  object?: string;
  url: string;
}

export interface UnipileUserProfile {
  provider_id?: string;
  public_identifier?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  summary?: string;
  location?: string;
  network_distance?: string; // e.g. "FIRST_DEGREE" | "SECOND_DEGREE" | "DISTANCE_1"
  current_company?: string;
  occupation?: string;
  // some payloads nest the public profile url
  public_profile_url?: string;
}

export interface UnipileSendResponse {
  // chat send returns the created chat/message ids; field names vary by endpoint
  object?: string;
  chat_id?: string;
  message_id?: string;
  id?: string;
}

/** Generic Unipile error body (RFC-7807-ish). */
export interface UnipileErrorBody {
  status?: number;
  type?: string;
  title?: string;
  detail?: string;
  message?: string;
}

/** Custom proxy object for account connection (Unipile docs: host/port/username/password). */
export interface UnipileProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

// --- LinkedIn search / lead sourcing --------------------------------------

/**
 * Body for POST /api/v1/linkedin/search. `api` selects the LinkedIn surface
 * (classic search vs Sales Navigator); `category` is the entity type. Either a
 * parsed search `url` OR free-text `keywords` drives the query. Fields we don't
 * rely on are omitted — Unipile ignores unknown keys.
 */
export interface UnipileSearchRequest {
  api: "classic" | "sales_navigator";
  category: "people";
  url?: string;
  keywords?: string;
}

/**
 * One row from a LinkedIn search / reaction / comment response. Field names vary
 * across the classic, Sales-Navigator and engagement surfaces, so everything is
 * optional and read defensively (mirrors UnipileUserProfile).
 */
export interface UnipileSearchItem {
  object?: string;
  type?: string;
  id?: string;
  provider_id?: string;
  member_id?: string;
  public_identifier?: string;
  public_profile_url?: string;
  profile_url?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  occupation?: string;
  current_company?: string;
  company?: string;
  location?: string;
  network_distance?: string;
  /** Engagement endpoints nest the person under author/actor. */
  author?: UnipileSearchItem;
  actor?: UnipileSearchItem;
}

export interface UnipileSearchResponse {
  object?: string;
  items?: UnipileSearchItem[];
  cursor?: string | null;
  paging?: { total_count?: number; total?: number };
}

/**
 * One row from GET /api/v1/users/relations (the account owner's 1st-degree
 * connections). Field names follow Unipile's relations payload; read defensively
 * (loose, like UnipileSearchItem). To confirm in a live-account test.
 */
export interface UnipileRelationItem {
  object?: string;
  member_id?: string;
  member_urn?: string;
  provider_id?: string;
  public_identifier?: string;
  public_profile_url?: string;
  profile_url?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  headline?: string;
  occupation?: string;
  current_company?: string;
  company?: string;
  location?: string;
}

export interface UnipileRelationsResponse {
  object?: string;
  items?: UnipileRelationItem[];
  cursor?: string | null;
  paging?: { total_count?: number; total?: number };
}

// --- webhook payloads -----------------------------------------------------

export interface UnipileMessagingWebhook {
  event: string; // "message_received" | "message_read" | "message_reaction" | ...
  account_id: string;
  chat_id?: string;
  message?: string;
  message_id?: string;
  timestamp?: string;
  sender?: {
    attendee_provider_id?: string;
    attendee_name?: string;
  };
  account_info?: {
    user_id?: string; // the connected account owner's provider id
  };
}

export interface UnipileAccountStatusWebhook {
  AccountStatus: {
    account_id: string;
    account_type?: string;
    message: string; // OK | CREDENTIALS | ERROR | STOPPED | CONNECTING | ...
  };
}

export interface UnipileRelationWebhook {
  // "relations" source — a new connection (invitation accepted). Field names are
  // not fully documented; we read defensively.
  account_id?: string;
  event?: string;
  user_provider_id?: string;
  provider_id?: string;
  user_public_identifier?: string;
  timestamp?: string;
}
