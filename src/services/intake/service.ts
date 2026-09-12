import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ReviewStatus } from "@/types/database.types";

/**
 * Business logic for the Sleep Intake Copilot domain, kept separate from
 * both the UI and the HTTP transport layer ("Keep business logic separate
 * from UI"). This replaces the old generic `ai_outputs` service — the
 * real schema is patient-facing intake sessions plus clinician summaries
 * that always start life as `pending_review` and are never trusted until
 * a clinician explicitly approves or rejects them ("Keep AI output
 * reviewable").
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** All intake sessions belonging to the signed-in patient. */
export async function listMyIntakeSessions(
  supabase: TypedSupabaseClient,
  patientId: string
) {
  const { data, error } = await supabase
    .from("intake_sessions")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list intake sessions: ${error.message}`);
  }

  return data;
}

/** Starts a new, empty intake session for the signed-in patient. */
export async function createIntakeSession(
  supabase: TypedSupabaseClient,
  patientId: string
) {
  const { data, error } = await supabase
    .from("intake_sessions")
    .insert({
      patient_id: patientId,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create intake session: ${error.message}`);
  }

  return data;
}

/**
 * Updates the chief complaint on one of the patient's own sessions. RLS
 * only allows this while the session is still 'not_started' or
 * 'in_progress' (see 0001_init.sql).
 */
export async function updateIntakeSessionComplaint(
  supabase: TypedSupabaseClient,
  patientId: string,
  sessionId: string,
  chiefComplaint: string
) {
  const { data, error } = await supabase
    .from("intake_sessions")
    .update({ chief_complaint: chiefComplaint })
    .eq("id", sessionId)
    .eq("patient_id", patientId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update intake session: ${error.message}`);
  }

  return data;
}

/**
 * Deletes (abandons) one of the patient's own sessions. RLS only allows
 * this while the session is still 'not_started' or 'in_progress' (see
 * 0002_intake_session_delete_policy.sql) — a completed/reviewed session
 * can never be deleted this way.
 */
export async function deleteIntakeSession(
  supabase: TypedSupabaseClient,
  patientId: string,
  sessionId: string
) {
  const { error } = await supabase
    .from("intake_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("patient_id", patientId);

  if (error) {
    throw new Error(`Failed to delete intake session: ${error.message}`);
  }
}

/**
 * Clinician summaries still waiting for a human clinician to approve or
 * reject them. RLS (`is_clinician()`) also enforces at the database level
 * that only clinicians can see summaries for patients other than
 * themselves — this is defense in depth, not the only check.
 */
export async function listPendingClinicianSummaries(
  supabase: TypedSupabaseClient
) {
  const { data, error } = await supabase
    .from("clinician_summaries")
    .select("*")
    .eq("status", "pending_review")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list clinician summaries: ${error.message}`);
  }

  return data;
}

/** A clinician approves or rejects one AI-generated summary. */
export async function reviewClinicianSummary(
  supabase: TypedSupabaseClient,
  clinicianId: string,
  summaryId: string,
  decision: Extract<ReviewStatus, "approved" | "rejected">
) {
  const { data, error } = await supabase
    .from("clinician_summaries")
    .update({
      status: decision,
      reviewed_by: clinicianId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", summaryId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to review clinician summary: ${error.message}`);
  }

  return data;
}
