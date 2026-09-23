import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ESS_DOMAIN, ESS_QUESTION_KEYS } from "@/lib/ess";
import { STOPBANG_DOMAIN, STOPBANG_QUESTION_KEYS } from "@/lib/stopbang";
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
 * One intake session, but only if it belongs to the signed-in patient.
 * Returns null rather than throwing so the page can redirect instead of
 * rendering an error — an unknown id and someone else's id are deliberately
 * indistinguishable here, so this can't be used to probe for valid ids.
 */
export async function getMyIntakeSession(
  supabase: TypedSupabaseClient,
  patientId: string,
  sessionId: string
) {
  const { data, error } = await supabase
    .from("intake_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("patient_id", patientId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load intake session: ${error.message}`);
  }

  return data;
}

/**
 * The STOP-BANG answers already saved on a session, as a
 * { question_key: boolean } map, so the form can be reopened with the
 * patient's previous answers filled in rather than blank.
 */
export async function getStopBangAnswers(
  supabase: TypedSupabaseClient,
  sessionId: string
): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from("intake_responses")
    .select("question_key, answer_value")
    .eq("session_id", sessionId)
    .in("question_key", STOPBANG_QUESTION_KEYS);

  if (error) {
    throw new Error(`Failed to load saved answers: ${error.message}`);
  }

  const answers: Record<string, boolean> = {};
  for (const row of data ?? []) {
    answers[row.question_key] = row.answer_value === true;
  }
  return answers;
}

/**
 * Writes one questionnaire's answers to `intake_responses`.
 *
 * Shared by every instrument, because the awkward part is the same for all of
 * them: `intake_responses` has no unique constraint on
 * (session_id, question_key) and patients have no DELETE policy on it, so an
 * upsert is not available. This reads what is already there, updates those
 * rows, and inserts only the missing ones — which is what keeps re-submitting
 * a form from piling up duplicate, conflicting answers for the same question.
 *
 * Values that are neither a boolean nor a finite number are skipped rather
 * than stored. `answer_value` is jsonb and would happily accept a string or a
 * null, and a scoring engine reading that back would treat it as unanswered —
 * so the row would exist, look answered in the database, and score as a gap.
 * Refusing it here keeps those two views of the data honest.
 */
async function saveStructuredResponses(
  supabase: TypedSupabaseClient,
  sessionId: string,
  domain: string,
  questionKeys: readonly string[],
  answers: Record<string, unknown>
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("intake_responses")
    .select("id, question_key")
    .eq("session_id", sessionId)
    .in("question_key", questionKeys as string[]);

  if (existingError) {
    throw new Error(`Failed to read existing answers: ${existingError.message}`);
  }

  const existingByKey = new Map(
    (existing ?? []).map((row) => [row.question_key, row.id])
  );

  const toInsert: {
    session_id: string;
    question_key: string;
    question_domain: string;
    answer_value: boolean | number;
    source: "structured_choice";
  }[] = [];

  for (const key of questionKeys) {
    const value = answers[key];

    const usable =
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value));

    if (!usable) continue;

    const storable = value as boolean | number;
    const existingId = existingByKey.get(key);

    if (existingId) {
      const { error } = await supabase
        .from("intake_responses")
        .update({ answer_value: storable })
        .eq("id", existingId);

      if (error) {
        throw new Error(`Failed to update answer "${key}": ${error.message}`);
      }
    } else {
      toInsert.push({
        session_id: sessionId,
        question_key: key,
        question_domain: domain,
        answer_value: storable,
        source: "structured_choice",
      });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("intake_responses").insert(toInsert);

    if (error) {
      throw new Error(`Failed to save answers: ${error.message}`);
    }
  }
}

export interface StopBangIntakeInput {
  heightCm: number | null;
  weightKg: number | null;
  neckCircumferenceCm: number | null;
  dateOfBirth: string | null;
  sex: "male" | "female" | "other" | null;
  /** question_key -> yes/no. Keys not in STOPBANG_QUESTION_KEYS are ignored. */
  answers: Record<string, boolean>;
}

/**
 * Saves everything the STOP-BANG form collects, in the three places each
 * piece belongs:
 *
 *   - date of birth + sex  -> profiles       (they describe the person, not
 *                                             this one visit)
 *   - height/weight/neck   -> intake_sessions (they can change between visits,
 *                                             and BMI is generated from them)
 *   - the four yes/no items -> intake_responses
 *
 * Every write goes through the patient's own client, so RLS — not this
 * function — is what ultimately enforces that a patient can only write to
 * their own session, and only while it is still open.
 *
 * Note this is not a transaction: Supabase's REST API has no cross-table
 * transaction. A partial save is recoverable (the patient reopens the form and
 * saves again) and nothing downstream reads these rows until scoring runs, so
 * the simplicity is worth more here than atomicity.
 */
export async function saveStopBangIntake(
  supabase: TypedSupabaseClient,
  userId: string,
  sessionId: string,
  input: StopBangIntakeInput
) {
  // 1. Person-level facts.
  if (input.dateOfBirth !== null || input.sex !== null) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
      })
      .eq("id", userId);

    if (profileError) {
      throw new Error(`Failed to save your details: ${profileError.message}`);
    }
  }

  // 2. Visit-level measurements. BMI is a generated column — never write it.
  const { data: session, error: sessionError } = await supabase
    .from("intake_sessions")
    .update({
      height_cm: input.heightCm,
      weight_kg: input.weightKg,
      neck_circumference_cm: input.neckCircumferenceCm,
    })
    .eq("id", sessionId)
    .eq("patient_id", userId)
    .select()
    .single();

  if (sessionError) {
    throw new Error(`Failed to save measurements: ${sessionError.message}`);
  }

  // 3. The four questionnaire answers.
  await saveStructuredResponses(
    supabase,
    sessionId,
    STOPBANG_DOMAIN,
    STOPBANG_QUESTION_KEYS,
    input.answers
  );

  return session;
}

/**
 * The ESS answers already saved on a session, as a { question_key: 0|1|2|3 }
 * map, so the form can be reopened with the patient's previous answers
 * selected rather than blank.
 *
 * Keys whose stored value is not one of the four valid scores are left out
 * entirely rather than defaulted to 0. A questionnaire that shows a patient an
 * answer they never gave is worse than one that shows a blank.
 */
export async function getEssAnswers(
  supabase: TypedSupabaseClient,
  sessionId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("intake_responses")
    .select("question_key, answer_value")
    .eq("session_id", sessionId)
    .in("question_key", ESS_QUESTION_KEYS);

  if (error) {
    throw new Error(`Failed to load saved answers: ${error.message}`);
  }

  const answers: Record<string, number> = {};
  for (const row of data ?? []) {
    const value = row.answer_value;
    if (value === 0 || value === 1 || value === 2 || value === 3) {
      answers[row.question_key] = value;
    }
  }
  return answers;
}

export interface EssIntakeInput {
  /** question_key -> 0|1|2|3. Keys not in ESS_QUESTION_KEYS are ignored. */
  answers: Record<string, number>;
}

/**
 * Saves the ESS answers for one session.
 *
 * Simpler than its STOP-BANG counterpart because ESS asks nothing about the
 * person or their measurements — all eight items are questions, so there is
 * only one table to write to.
 *
 * The session is read first, filtered by patient_id, for two reasons: the
 * caller needs the session row back, and reaching the next line proves the
 * signed-in user owns this session, which is what makes it safe for the route
 * to hand the id to the service-role scoring engine afterwards. RLS would stop
 * a foreign write regardless, but an explicit check here fails cleanly with
 * "not found" instead of a confusing partial save.
 */
export async function saveEssIntake(
  supabase: TypedSupabaseClient,
  userId: string,
  sessionId: string,
  input: EssIntakeInput
) {
  const { data: session, error: sessionError } = await supabase
    .from("intake_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("patient_id", userId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Failed to load intake session: ${sessionError.message}`);
  }

  if (!session) {
    throw new Error("ไม่พบแบบประเมินนี้ หรือคุณไม่มีสิทธิ์เข้าถึง");
  }

  await saveStructuredResponses(
    supabase,
    sessionId,
    ESS_DOMAIN,
    ESS_QUESTION_KEYS,
    input.answers
  );

  return session;
}

/** One STOP-BANG letter as the clinician view renders it. */
export interface StopBangBreakdownItem {
  letter: string;
  label: string;
  scored: boolean;
  answered: boolean;
}

/** One ESS item as the clinician view renders it. */
export interface EssBreakdownItem {
  field: string;
  position: number;
  label: string;
  score: number | null;
  answered: boolean;
}

export interface ClinicianSessionView {
  id: string;
  patientName: string | null;
  status: Database["public"]["Tables"]["intake_sessions"]["Row"]["status"];
  chiefComplaint: string | null;
  bmi: number | null;
  createdAt: string;
  stopBang: {
    score: number;
    riskCategory: string | null;
    incomplete: boolean;
    answeredCount: number;
    maxPossibleScore: number;
    breakdown: StopBangBreakdownItem[];
    computedAt: string;
  } | null;
  /**
   * Null when the patient has not submitted the sleepiness questionnaire yet.
   * Kept as its own field rather than folded in with STOP-BANG: the two
   * instruments measure different things, are answered at different times, and
   * a clinician needs to see which one is missing.
   */
  ess: {
    score: number;
    severity: string | null;
    incomplete: boolean;
    answeredCount: number;
    maxPossibleScore: number;
    breakdown: EssBreakdownItem[];
    computedAt: string;
  } | null;
  flags: {
    id: string;
    flagType: string;
    severity: Database["public"]["Tables"]["safety_flags"]["Row"]["severity"];
    triggerSource: string;
    acknowledgedAt: string | null;
  }[];
}

/**
 * Narrows the jsonb `score_breakdown` column back into the shape we wrote.
 *
 * jsonb carries no type information, so the cast is unavoidable; what this
 * function guarantees is that a missing, malformed or hand-edited value
 * degrades to an empty breakdown with zeroed counts instead of throwing in the
 * middle of a clinician's list. The caller decides which item shape it wrote.
 */
function readScoreBreakdown<T>(value: unknown): {
  breakdown: T[];
  answeredCount: number;
  incomplete: boolean;
  maxPossibleScore: number;
} {
  const empty = {
    breakdown: [] as T[],
    answeredCount: 0,
    incomplete: false,
    maxPossibleScore: 0,
  };

  if (typeof value !== "object" || value === null) return empty;

  const obj = value as Record<string, unknown>;
  return {
    breakdown: Array.isArray(obj.breakdown)
      ? (obj.breakdown as T[])
      : empty.breakdown,
    answeredCount:
      typeof obj.answeredCount === "number" ? obj.answeredCount : 0,
    incomplete: obj.incomplete === true,
    maxPossibleScore:
      typeof obj.maxPossibleScore === "number" ? obj.maxPossibleScore : 0,
  };
}

/**
 * The clinician's working list: recent intake sessions, each with its
 * STOP-BANG score and any safety flags.
 *
 * This deliberately runs four small queries and joins them in JavaScript
 * rather than using one nested PostgREST select. The hand-written types in
 * database.types.ts declare no `Relationships`, so embedded-resource type
 * inference silently degrades — which is exactly the failure mode that has
 * broken this project's production build before. Four plain queries stay
 * typed, and at this scale the cost is irrelevant.
 *
 * RLS still governs every one of them: a patient calling this would get back
 * only their own rows, and only a clinician sees other patients' data.
 */
export async function listIntakeSessionsForReview(
  supabase: TypedSupabaseClient,
  limit = 50
): Promise<ClinicianSessionView[]> {
  const { data: sessions, error } = await supabase
    .from("intake_sessions")
    .select("id, patient_id, status, chief_complaint, bmi, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list intake sessions: ${error.message}`);
  }

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const patientIds = [...new Set(sessions.map((s) => s.patient_id))];

  const [profilesResult, scoresResult, flagsResult] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", patientIds),
    supabase
      .from("questionnaire_scores")
      .select("session_id, instrument, score, risk_category, score_breakdown, computed_at")
      .in("session_id", sessionIds)
      .in("instrument", ["STOP_BANG", "ESS"]),
    supabase
      .from("safety_flags")
      .select("id, session_id, flag_type, severity, trigger_source, acknowledged_at")
      .in("session_id", sessionIds),
  ]);

  const nameById = new Map(
    (profilesResult.data ?? []).map((p) => [p.id, p.full_name])
  );
  // One row per (session, instrument), so the rows are split by instrument
  // rather than keyed by session alone — keying by session would have ESS and
  // STOP-BANG overwrite each other and show whichever arrived last.
  const stopBangBySession = new Map(
    (scoresResult.data ?? [])
      .filter((s) => s.instrument === "STOP_BANG")
      .map((s) => [s.session_id, s])
  );
  const essBySession = new Map(
    (scoresResult.data ?? [])
      .filter((s) => s.instrument === "ESS")
      .map((s) => [s.session_id, s])
  );

  const flagsBySession = new Map<string, ClinicianSessionView["flags"]>();
  for (const flag of flagsResult.data ?? []) {
    const list = flagsBySession.get(flag.session_id) ?? [];
    list.push({
      id: flag.id,
      flagType: flag.flag_type,
      severity: flag.severity,
      triggerSource: flag.trigger_source,
      acknowledgedAt: flag.acknowledged_at,
    });
    flagsBySession.set(flag.session_id, list);
  }

  return sessions.map((session) => {
    const score = stopBangBySession.get(session.id);
    const breakdown = score
      ? readScoreBreakdown<StopBangBreakdownItem>(score.score_breakdown)
      : null;

    const essScore = essBySession.get(session.id);
    const essBreakdown = essScore
      ? readScoreBreakdown<EssBreakdownItem>(essScore.score_breakdown)
      : null;

    return {
      id: session.id,
      patientName: nameById.get(session.patient_id) ?? null,
      status: session.status,
      chiefComplaint: session.chief_complaint,
      bmi: session.bmi,
      createdAt: session.created_at,
      stopBang:
        score && breakdown
          ? {
              score: Number(score.score),
              riskCategory: score.risk_category,
              incomplete: breakdown.incomplete,
              answeredCount: breakdown.answeredCount,
              maxPossibleScore: breakdown.maxPossibleScore,
              breakdown: breakdown.breakdown,
              computedAt: score.computed_at,
            }
          : null,
      ess:
        essScore && essBreakdown
          ? {
              score: Number(essScore.score),
              severity: essScore.risk_category,
              incomplete: essBreakdown.incomplete,
              answeredCount: essBreakdown.answeredCount,
              maxPossibleScore: essBreakdown.maxPossibleScore,
              breakdown: essBreakdown.breakdown,
              computedAt: essScore.computed_at,
            }
          : null,
      flags: flagsBySession.get(session.id) ?? [],
    };
  });
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
