// Database types for the public schema. Shape matches `supabase gen types
// typescript --schema public`. Regenerate with `pnpm --filter @10xconnect/db
// db:gen-types` once logged in (`supabase login` or SUPABASE_ACCESS_TOKEN).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          settings: Json;
          branding: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          settings?: Json;
          branding?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_id?: string;
          settings?: Json;
          branding?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["membership_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["membership_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["membership_role"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sending_accounts: {
        Row: {
          id: string;
          workspace_id: string;
          type: Database["public"]["Enums"]["sending_account_type"];
          connection_method: Database["public"]["Enums"]["connection_method"] | null;
          name: string | null;
          proxy_type: Database["public"]["Enums"]["proxy_type"] | null;
          proxy_region: string | null;
          location: string | null;
          country: string | null;
          status: Database["public"]["Enums"]["sending_account_status"];
          health_score: number;
          warmup_state: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          type: Database["public"]["Enums"]["sending_account_type"];
          connection_method?: Database["public"]["Enums"]["connection_method"] | null;
          name?: string | null;
          proxy_type?: Database["public"]["Enums"]["proxy_type"] | null;
          proxy_region?: string | null;
          location?: string | null;
          country?: string | null;
          status?: Database["public"]["Enums"]["sending_account_status"];
          health_score?: number;
          warmup_state?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          type?: Database["public"]["Enums"]["sending_account_type"];
          connection_method?: Database["public"]["Enums"]["connection_method"] | null;
          name?: string | null;
          proxy_type?: Database["public"]["Enums"]["proxy_type"] | null;
          proxy_region?: string | null;
          location?: string | null;
          country?: string | null;
          status?: Database["public"]["Enums"]["sending_account_status"];
          health_score?: number;
          warmup_state?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contact_lists: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          workspace_id: string;
          linkedin_url: string | null;
          email: string | null;
          enrichment: Json;
          tags: string[];
          custom_columns: Json;
          dedupe_key: string | null;
          enrich_status: Database["public"]["Enums"]["enrich_status"];
          connection_degree: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          linkedin_url?: string | null;
          email?: string | null;
          enrichment?: Json;
          tags?: string[];
          custom_columns?: Json;
          dedupe_key?: string | null;
          enrich_status?: Database["public"]["Enums"]["enrich_status"];
          connection_degree?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          linkedin_url?: string | null;
          email?: string | null;
          enrichment?: Json;
          tags?: string[];
          custom_columns?: Json;
          dedupe_key?: string | null;
          enrich_status?: Database["public"]["Enums"]["enrich_status"];
          connection_degree?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      list_leads: {
        Row: {
          workspace_id: string;
          list_id: string;
          lead_id: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          list_id: string;
          lead_id: string;
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          list_id?: string;
          lead_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          status: Database["public"]["Enums"]["campaign_status"];
          account_id: string | null;
          schedule: Json;
          caps: Json;
          settings: Json;
          share_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          status?: Database["public"]["Enums"]["campaign_status"];
          account_id?: string | null;
          schedule?: Json;
          caps?: Json;
          settings?: Json;
          share_token?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          status?: Database["public"]["Enums"]["campaign_status"];
          account_id?: string | null;
          schedule?: Json;
          caps?: Json;
          settings?: Json;
          share_token?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sequence_nodes: {
        Row: {
          id: string;
          workspace_id: string;
          campaign_id: string;
          kind: Database["public"]["Enums"]["sequence_node_kind"];
          type: string;
          config: Json;
          next_node_id: string | null;
          true_node_id: string | null;
          false_node_id: string | null;
          delay_days: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          campaign_id: string;
          kind: Database["public"]["Enums"]["sequence_node_kind"];
          type: string;
          config?: Json;
          next_node_id?: string | null;
          true_node_id?: string | null;
          false_node_id?: string | null;
          delay_days?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          campaign_id?: string;
          kind?: Database["public"]["Enums"]["sequence_node_kind"];
          type?: string;
          config?: Json;
          next_node_id?: string | null;
          true_node_id?: string | null;
          false_node_id?: string | null;
          delay_days?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lead_campaign_state: {
        Row: {
          id: string;
          workspace_id: string;
          lead_id: string;
          campaign_id: string;
          current_node_id: string | null;
          status: string;
          history: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          lead_id: string;
          campaign_id: string;
          current_node_id?: string | null;
          status?: string;
          history?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          lead_id?: string;
          campaign_id?: string;
          current_node_id?: string | null;
          status?: string;
          history?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          workspace_id: string;
          account_id: string | null;
          lead_id: string | null;
          channel: Database["public"]["Enums"]["channel_type"];
          pipeline_stage: Database["public"]["Enums"]["conversation_pipeline_stage"];
          snooze_until: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          account_id?: string | null;
          lead_id?: string | null;
          channel: Database["public"]["Enums"]["channel_type"];
          pipeline_stage?: Database["public"]["Enums"]["conversation_pipeline_stage"];
          snooze_until?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          account_id?: string | null;
          lead_id?: string | null;
          channel?: Database["public"]["Enums"]["channel_type"];
          pipeline_stage?: Database["public"]["Enums"]["conversation_pipeline_stage"];
          snooze_until?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          workspace_id: string;
          conversation_id: string;
          direction: Database["public"]["Enums"]["message_direction"];
          channel: Database["public"]["Enums"]["channel_type"];
          body: string | null;
          voice_ref: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          conversation_id: string;
          direction: Database["public"]["Enums"]["message_direction"];
          channel: Database["public"]["Enums"]["channel_type"];
          body?: string | null;
          voice_ref?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          conversation_id?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          channel?: Database["public"]["Enums"]["channel_type"];
          body?: string | null;
          voice_ref?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      actions: {
        Row: {
          id: string;
          workspace_id: string;
          account_id: string | null;
          lead_id: string | null;
          type: string;
          idempotency_key: string;
          scheduled_at: string | null;
          executed_at: string | null;
          result: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          account_id?: string | null;
          lead_id?: string | null;
          type: string;
          idempotency_key: string;
          scheduled_at?: string | null;
          executed_at?: string | null;
          result?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          account_id?: string | null;
          lead_id?: string | null;
          type?: string;
          idempotency_key?: string;
          scheduled_at?: string | null;
          executed_at?: string | null;
          result?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      voice_profiles: {
        Row: {
          id: string;
          user_id: string;
          model_ref: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          model_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          model_ref?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      api_keys: {
        Row: {
          id: string;
          workspace_id: string;
          hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          hash: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          hash?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhooks: {
        Row: {
          id: string;
          workspace_id: string;
          url: string;
          events: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          url: string;
          events?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          url?: string;
          events?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          workspace_id: string;
          plan: string | null;
          slot_count: number;
          billing_cycle: Database["public"]["Enums"]["billing_cycle"] | null;
          status: Database["public"]["Enums"]["subscription_status"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          plan?: string | null;
          slot_count?: number;
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"] | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          plan?: string | null;
          slot_count?: number;
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"] | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_workspace_member: {
        Args: { target_workspace_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      membership_role: "owner" | "admin" | "member";
      sending_account_type: "linkedin" | "mailbox";
      connection_method: "extension" | "credentials";
      proxy_type: "bundled" | "own";
      sending_account_status: "active" | "warming" | "paused" | "restricted" | "disconnected";
      enrich_status: "pending" | "enriching" | "enriched" | "failed";
      campaign_status: "draft" | "pending" | "running" | "stopped" | "completed";
      sequence_node_kind: "action" | "condition";
      conversation_pipeline_stage: "new" | "in_conversation" | "qualified" | "booked" | "lost";
      channel_type: "linkedin" | "email";
      message_direction: "inbound" | "outbound";
      billing_cycle: "monthly" | "annual";
      subscription_status: "not_activated" | "trial" | "active" | "canceled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
