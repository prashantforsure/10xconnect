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
