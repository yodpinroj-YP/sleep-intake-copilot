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
/**
 * 'clinician' is a legacy value: it predates the nurse/physician split and
 * cannot be removed, because PostgreSQL enums only grow. Nothing new is
 * written with it — 0007 converted the rows that held it — but it stays
 * accepted so an unconverted account keeps its read access instead of
 * silently losing it. Use the helpers in `src/lib/roles.ts` rather than
 * comparing to these strings.
 */
export type UserRole =
  | "patient"
  | "nurse"
  | "physician"
  | "clinician"
  | "admin";
export type IntakeStatus = "not_started" | "in_progress" | "completed" | "abandoned";
export type ReviewStatus = "pending_review" | "approved" | "rejected";
export type ResponseSource = "structured_choice" | "free_text" | "ai_extracted";
export type FlagSeverity = "standard" | "urgent";
export type QuestionnaireInstrument = "ESS" | "STOP_BANG" | "ISI" | "BERLIN";
/**
 * Mirrors the check constraint on audit_log.action in 0009_audit_log.sql.
 * The canonical list — the one that actually refuses an unknown value — is
 * the constraint; `AUDIT_ACTIONS` in src/services/audit/audit-events.ts is
 * the third copy, and a test asserts the two TypeScript copies agree.
 */
export type AuditActionName =
  | "record_viewed"
  | "summary_requested"
  | "summary_approved"
  | "summary_rejected"
  | "answers_saved"
  | "answer_retracted"
  | "session_deleted"
  | "consent_granted"
  | "consent_withdrawn";

/** Mirrors the check constraint on consents.purpose in 0010_consents.sql. */
export type ConsentPurposeName = "care" | "ai_summary" | "research";
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
      /**
       * Append-only. There is no `Update` shape that the database will accept
       * — 0009 installs triggers that raise on UPDATE and DELETE, service role
       * included — so the types here say so rather than offering a call that
       * always fails at runtime.
       */
      audit_log: {
        Row: {
          id: number;
          occurred_at: string;
          actor_id: string | null;
          actor_role: UserRole | null;
          action: AuditActionName;
          patient_id: string | null;
          session_id: string | null;
          entity_table: string | null;
          entity_id: string | null;
          details: unknown;
        };
        Insert: {
          occurred_at?: string;
          actor_id?: string | null;
          actor_role?: UserRole | null;
          action: AuditActionName;
          patient_id?: string | null;
          session_id?: string | null;
          entity_table?: string | null;
          entity_id?: string | null;
          details?: unknown;
        };
        Update: never;
        Relationships: [];
      };
      /**
       * Append-only, like audit_log and for a related reason: a consent row
       * has to show what was agreed on the day the data was collected, so
       * 0010 installs triggers that refuse UPDATE and DELETE. Withdrawal is a
       * new row with granted = false.
       */
      consents: {
        Row: {
          id: number;
          patient_id: string;
          purpose: ConsentPurposeName;
          granted: boolean;
          text_version: string;
          recorded_at: string;
          recorded_by: string;
          source: "patient_web" | "staff_entry";
        };
        Insert: {
          patient_id: string;
          purpose: ConsentPurposeName;
          granted: boolean;
          text_version: string;
          recorded_at?: string;
          recorded_by: string;
          source?: "patient_web" | "staff_entry";
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      /**
       * The newest consent row per (patient, purpose), derived rather than
       * stored. Declared with security_invoker so the base table's policies
       * still apply — see the note in 0010_consents.sql.
       */
      current_consents: {
        Row: {
          patient_id: string;
          purpose: ConsentPurposeName;
          granted: boolean;
          text_version: string;
          recorded_at: string;
        };
        Relationships: [];
      };
    };
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
