/**
 * Hand-written starter types matching supabase/migrations/0001_init.sql.
 *
 * Once the project is linked to a real Supabase project, replace this
 * file with generated types so it never drifts from the real schema:
 *
 *   npx supabase gen types typescript --project-id <project-ref> \
 *     --schema public > src/types/database.types.ts
 */
export type AiOutputStatus = "pending_review" | "approved" | "rejected";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_outputs: {
        Row: {
          id: string;
          user_id: string;
          prompt: string;
          response: string;
          model: string;
          status: AiOutputStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          prompt: string;
          response: string;
          model: string;
          status?: AiOutputStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          prompt?: string;
          response?: string;
          model?: string;
          status?: AiOutputStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      ai_output_status: AiOutputStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
