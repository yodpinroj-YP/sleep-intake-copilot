/**
 * Hand-written starter types matching supabase/migrations/0001_init.sql
 * (Sleep Intake Copilot schema — see DATABASE.md for the full design
 * rationale).
 *
 * Once the project is linked to a real Supabase project, replace this
 * file with generated types so it never drifts from the real schema:
 *
 *   npx supabase gen types typescript --project-id <project-ref> \
 *     --schema public > src/types/database.types.ts
 */
export type UserRole = "patient" | "clinician" | "admin";
export type IntakeStatus = "not_started" | "in_progress" | "completed" | "abandoned";
export type ReviewStatus = "pending_review" | "approved" | "rejected";
export type ResponseSource = "structured_choice" | "free_text" | "ai_extracted";
export type FlagSeverity = "standard" | "urgent";
export type QuestionnaireInstrument = "ESS" | "STOP_BANG" | "ISI" | "BERLIN";
export type AiProcessingFeature =
  | "nlu_extraction"
  | "adaptive_question_selection"
  | "summarization"
  | "gap_detection";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string | null;
          date_of_birth: string | null;
          sex: "male" | "female" | "other" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          full_name?: string | null;
          date_of_birth?: string | null;
          sex?: "male" | "female" | "other" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          role?: UserRole;
          full_name?: string | null;
          date_of_birth?: string | null;
          sex?: "male" | "female" | "other" | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      intake_sessions: {
        Row: {
          id: string;
          patient_id: string;
          status: IntakeStatus;
          chief_complaint: string | null;
          height_cm: number | null;
          weight_kg: number | null;
          neck_circumference_cm: number | null;
          bmi: number | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          status?: IntakeStatus;
          chief_complaint?: string | null;
          height_cm?: number | null;
          weight_kg?: number | null;
          neck_circumference_cm?: number | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          status?: IntakeStatus;
          chief_complaint?: string | null;
          height_cm?: number | null;
          weight_kg?: number | null;
          neck_circumference_cm?: number | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      intake_responses: {
        Row: {
          id: string;
          session_id: string;
          question_key: string;
          question_domain: string;
          answer_value: unknown;
          source: ResponseSource;
          raw_patient_text: string | null;
          extraction_confidence: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          question_key: string;
          question_domain: string;
          answer_value: unknown;
          source?: ResponseSource;
          raw_patient_text?: string | null;
          extraction_confidence?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          question_key?: string;
          question_domain?: string;
          answer_value?: unknown;
          source?: ResponseSource;
          raw_patient_text?: string | null;
          extraction_confidence?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      questionnaire_scores: {
        Row: {
          id: string;
          session_id: string;
          instrument: QuestionnaireInstrument;
          raw_answers: unknown;
          score: number;
          score_breakdown: unknown;
          risk_category: string | null;
          computed_by: string;
          computed_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          instrument: QuestionnaireInstrument;
          raw_answers: unknown;
          score: number;
          score_breakdown?: unknown;
          risk_category?: string | null;
          computed_by?: string;
          computed_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          instrument?: QuestionnaireInstrument;
          raw_answers?: unknown;
          score?: number;
          score_breakdown?: unknown;
          risk_category?: string | null;
          computed_by?: string;
          computed_at?: string;
        };
        Relationships: [];
      };
      safety_flags: {
        Row: {
          id: string;
          session_id: string;
          flag_type: string;
          severity: FlagSeverity;
          trigger_source: string;
          detected_at: string;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          flag_type: string;
          severity?: FlagSeverity;
          trigger_source: string;
          detected_at?: string;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          flag_type?: string;
          severity?: FlagSeverity;
          trigger_source?: string;
          detected_at?: string;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
        };
        Relationships: [];
      };
      clinician_summaries: {
        Row: {
          id: string;
          session_id: string;
          version: number;
          summary_text: string;
          key_symptoms: unknown;
          important_negatives: unknown;
          missing_information: unknown;
          needs_verification: unknown;
          model: string;
          prompt_version: string | null;
          status: ReviewStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          reviewer_notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          version?: number;
          summary_text: string;
          key_symptoms?: unknown;
          important_negatives?: unknown;
          missing_information?: unknown;
          needs_verification?: unknown;
          model: string;
          prompt_version?: string | null;
          status?: ReviewStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          reviewer_notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          version?: number;
          summary_text?: string;
          key_symptoms?: unknown;
          important_negatives?: unknown;
          missing_information?: unknown;
          needs_verification?: unknown;
          model?: string;
          prompt_version?: string | null;
          status?: ReviewStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          reviewer_notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_processing_logs: {
        Row: {
          id: string;
          session_id: string | null;
          feature: AiProcessingFeature;
          model: string;
          latency_ms: number | null;
          status: "success" | "error";
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          feature: AiProcessingFeature;
          model: string;
          latency_ms?: number | null;
          status?: "success" | "error";
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          feature?: AiProcessingFeature;
          model?: string;
          latency_ms?: number | null;
          status?: "success" | "error";
          error_message?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_clinician: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      intake_status: IntakeStatus;
      review_status: ReviewStatus;
      response_source: ResponseSource;
      flag_severity: FlagSeverity;
    };
    CompositeTypes: Record<string, never>;
  };
}
