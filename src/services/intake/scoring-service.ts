import "server-only";

import { STOPBANG_QUESTION_KEYS } from "@/lib/stopbang";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  calculateAgeYears,
  detectSafetyFlags,
  scoreStopBang,
} from "./stopbang-scoring.ts";
import type { StopBangInput, StopBangResult } from "./stopbang-scoring.ts";

/**
 * Computes a STOP-BANG score for one session and writes it to
 * `questionnaire_scores`.
 *
 * WHY THIS USES THE SERVICE-ROLE CLIENT
 *
 * `questionnaire_scores` has no INSERT policy for `authenticated` at all (see
 * 0001_init.sql) — by design. If the browser could write to it, a patient
 * could set their own risk score, and a clinician would be reading a number
 * the patient chose. So the only writer is this server-side engine.
 *
 * The service-role client bypasses RLS completely, which means the usual
 * safety net is gone and THIS FILE is responsible for authorization. It is
 * only ever called from a route that has already established, through the
 * patient's own RLS-bound client, that the caller owns the session.
 *
 * Nothing here calls an LLM. Everything written to `questionnaire_scores` is
 * produced by the pure functions in stopbang-scoring.ts, which are covered by
 * tests — that separation is what lets a clinician trust the number.
 */

export class MissingServiceRoleKeyError extends Error {
  constructor() {
    super(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (Supabase > Settings > API > service_role) and restart the dev server."
    );
    this.name = "MissingServiceRoleKeyError";
  }
}

/** Reads a stored jsonb answer back as a tri-state: true / false / not answered. */
function readBooleanAnswer(
  answers: Map<string, unknown>,
  key: string
): boolean | null {
  if (!answers.has(key)) return null;
  const value = answers.get(key);
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

export interface ScoreStopBangOutcome {
  result: StopBangResult;
  /** Exactly what was fed to the scoring function — stored for auditability. */
  input: StopBangInput;
  /** Flag types raised (or still standing) for this session after scoring. */
  activeFlagTypes: string[];
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Brings `safety_flags` into line with the score that was just computed.
 *
 * Re-submitting the questionnaire must not pile up duplicate flags, and a
 * flag raised from answers the patient has since corrected should not follow
 * them around forever. So this reconciles rather than blindly inserting:
 *
 *   - rule fires, no flag yet          -> insert
 *   - rule fires, flag already there   -> leave it (keeps the original
 *                                        detected_at, which is the clinically
 *                                        meaningful timestamp)
 *   - rule no longer fires, flag there -> withdraw it, BUT ONLY if no
 *                                        clinician has acknowledged it
 *
 * That last condition matters. Once a clinician has acknowledged a flag, it is
 * part of the record of what they saw and acted on. Deleting it because the
 * patient later edited an answer would quietly erase that. An acknowledged
 * flag therefore stays, even if the score has since dropped.
 */
async function syncSafetyFlags(
  admin: AdminClient,
  sessionId: string,
  result: StopBangResult
): Promise<string[]> {
  const candidates = detectSafetyFlags(result);
  const candidateTypes = new Set(candidates.map((c) => c.flagType));

  const { data: existing, error: readError } = await admin
    .from("safety_flags")
    .select("id, flag_type, acknowledged_at")
    .eq("session_id", sessionId);

  if (readError) {
    throw new Error(`Failed to read safety flags: ${readError.message}`);
  }

  const existingByType = new Map(
    (existing ?? []).map((row) => [row.flag_type, row])
  );

  // Raise any flag that should be there and isn't.
  const toInsert = candidates
    .filter((c) => !existingByType.has(c.flagType))
    .map((c) => ({
      session_id: sessionId,
      flag_type: c.flagType,
      severity: c.severity,
      trigger_source: c.triggerSource,
    }));

  if (toInsert.length > 0) {
    const { error } = await admin.from("safety_flags").insert(toInsert);
    if (error) {
      throw new Error(`Failed to raise safety flag: ${error.message}`);
    }
  }

  // Withdraw auto-raised flags whose rule no longer fires, unless a clinician
  // has already acknowledged them.
  const toWithdraw = (existing ?? []).filter(
    (row) => !candidateTypes.has(row.flag_type) && row.acknowledged_at === null
  );

  if (toWithdraw.length > 0) {
    const { error } = await admin
      .from("safety_flags")
      .delete()
      .in(
        "id",
        toWithdraw.map((row) => row.id)
      );

    if (error) {
      throw new Error(`Failed to withdraw stale safety flag: ${error.message}`);
    }
  }

  const withdrawnIds = new Set(toWithdraw.map((row) => row.id));
  return [
    ...(existing ?? [])
      .filter((row) => !withdrawnIds.has(row.id))
      .map((row) => row.flag_type),
    ...toInsert.map((row) => row.flag_type),
  ];
}

export async function scoreAndSaveStopBangSession(
  sessionId: string
): Promise<ScoreStopBangOutcome> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new MissingServiceRoleKeyError();
  }

  const admin = createAdminClient();

  // --- Gather the inputs -------------------------------------------------

  const { data: session, error: sessionError } = await admin
    .from("intake_sessions")
    .select("id, patient_id, bmi, neck_circumference_cm")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(
      `Cannot score: intake session not found (${sessionError?.message ?? "no row"})`
    );
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("date_of_birth, sex")
    .eq("id", session.patient_id)
    .single();

  const { data: responses, error: responsesError } = await admin
    .from("intake_responses")
    .select("question_key, answer_value")
    .eq("session_id", sessionId)
    .in("question_key", STOPBANG_QUESTION_KEYS);

  if (responsesError) {
    throw new Error(`Cannot score: ${responsesError.message}`);
  }

  const answers = new Map<string, unknown>(
    (responses ?? []).map((row) => [row.question_key, row.answer_value])
  );

  const input: StopBangInput = {
    snoring: readBooleanAnswer(answers, "stopbang_snoring"),
    tired: readBooleanAnswer(answers, "stopbang_tired"),
    observedApnea: readBooleanAnswer(answers, "stopbang_observed_apnea"),
    pressure: readBooleanAnswer(answers, "stopbang_pressure"),
    // BMI is the database's generated column, not a number the client sent.
    bmi: session.bmi,
    ageYears: calculateAgeYears(profile?.date_of_birth ?? null),
    neckCircumferenceCm: session.neck_circumference_cm,
    sex: profile?.sex ?? null,
  };

  // --- Score -------------------------------------------------------------

  const result = scoreStopBang(input);

  // --- Persist -----------------------------------------------------------
  //
  // `raw_answers` stores the exact input the score came from, so a score can
  // always be re-derived and checked later — if a threshold changes, you can
  // tell whether an old score is stale without going back to the raw tables.
  //
  // The upsert relies on the `unique (session_id, instrument)` constraint:
  // re-submitting the questionnaire replaces that session's STOP-BANG score
  // rather than accumulating conflicting rows.

  const { error: saveError } = await admin.from("questionnaire_scores").upsert(
    {
      session_id: sessionId,
      instrument: "STOP_BANG",
      raw_answers: input,
      score: result.score,
      score_breakdown: {
        breakdown: result.breakdown,
        answeredCount: result.answeredCount,
        incomplete: result.incomplete,
        maxPossibleScore: result.maxPossibleScore,
      },
      risk_category: result.riskCategory,
      computed_by: "deterministic_engine",
      computed_at: new Date().toISOString(),
    },
    { onConflict: "session_id,instrument" }
  );

  if (saveError) {
    throw new Error(`Failed to save score: ${saveError.message}`);
  }

  // --- Raise or withdraw safety flags based on the new score -------------

  const activeFlagTypes = await syncSafetyFlags(admin, sessionId, result);

  return { result, input, activeFlagTypes };
}
