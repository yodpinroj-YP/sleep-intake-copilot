import "server-only";

import { ESS_QUESTION_KEYS } from "@/lib/ess";
import { ISI_QUESTION_KEYS, ISI_SCREENING_QUESTION_KEY } from "@/lib/isi";
import { STOPBANG_QUESTION_KEYS } from "@/lib/stopbang";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  detectEssSafetyFlags,
  ESS_FIELDS,
  ESS_FLAG_TYPES,
  parseItemScore,
  scoreEss,
} from "./ess-scoring.ts";
import type { EssField, EssInput, EssResult } from "./ess-scoring.ts";
import {
  ISI_FIELDS,
  // Aliased on purpose. ESS answers run 0–3 and ISI answers run 0–4, so the
  // two parsers are not interchangeable and must never be confused for one
  // another at a call site.
  parseItemScore as parseIsiItemScore,
  scoreIsi,
} from "./isi-scoring.ts";
import type { IsiField, IsiInput, IsiResult } from "./isi-scoring.ts";
import {
  calculateAgeYears,
  detectSafetyFlags,
  scoreStopBang,
  STOPBANG_FLAG_TYPES,
} from "./stopbang-scoring.ts";
import type {
  SafetyFlagCandidate,
  StopBangInput,
  StopBangResult,
} from "./stopbang-scoring.ts";

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
 *
 * SCOPED TO ONE INSTRUMENT. `ownedFlagTypes` is the set of flags the calling
 * engine is responsible for, and nothing outside that set is ever inspected or
 * deleted. This is not a detail: a session can carry flags from STOP-BANG and
 * from ESS at the same time, and an unscoped "withdraw whatever this result no
 * longer justifies" would have each questionnaire delete the other's flags
 * every time a patient re-submitted — losing, among other things, the urgent
 * drowsy-driving flag, with nothing in the logs to show it had ever existed.
 */
async function syncSafetyFlags(
  admin: AdminClient,
  sessionId: string,
  candidates: SafetyFlagCandidate[],
  ownedFlagTypes: readonly string[]
): Promise<string[]> {
  const owned = new Set<string>(ownedFlagTypes);

  // A candidate outside the owned set could be raised but never withdrawn,
  // so treat it as the programming error it is rather than persisting it.
  for (const candidate of candidates) {
    if (!owned.has(candidate.flagType)) {
      throw new Error(
        `Flag "${candidate.flagType}" was raised by an engine that does not own it. ` +
          `Add it to that engine's flag-type list.`
      );
    }
  }

  const candidateTypes = new Set(candidates.map((c) => c.flagType));

  const { data: allExisting, error: readError } = await admin
    .from("safety_flags")
    .select("id, flag_type, acknowledged_at")
    .eq("session_id", sessionId);

  if (readError) {
    throw new Error(`Failed to read safety flags: ${readError.message}`);
  }

  // Everything below works only on this instrument's own flags.
  const existing = (allExisting ?? []).filter((row) => owned.has(row.flag_type));

  const existingByType = new Map(
    existing.map((row) => [row.flag_type, row])
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
  const toWithdraw = existing.filter(
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
    ...existing
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

  const activeFlagTypes = await syncSafetyFlags(
    admin,
    sessionId,
    detectSafetyFlags(result),
    STOPBANG_FLAG_TYPES
  );

  return { result, input, activeFlagTypes };
}

// ---------------------------------------------------------------------------
// Epworth Sleepiness Scale
// ---------------------------------------------------------------------------

/**
 * Maps each stored question key to the field the scoring engine expects.
 *
 * The map lives here rather than in lib/ess.ts or ess-scoring.ts because it is
 * the only place that legitimately knows both sides: the wording file owns the
 * keys the database stores, and the scoring file is kept free of imports so it
 * stays testable. Anything missing from this map throws at scoring time rather
 * than quietly producing a lower score — see buildEssInput.
 */
const ESS_KEY_TO_FIELD: Record<string, EssField> = {
  ess_sitting_reading: "sittingReading",
  ess_watching_tv: "watchingTv",
  ess_sitting_public: "sittingPublic",
  ess_passenger_car: "passengerCar",
  ess_lying_afternoon: "lyingAfternoon",
  ess_sitting_talking: "sittingTalking",
  ess_after_lunch: "afterLunch",
  ess_in_car_traffic: "inCarTraffic",
};

function buildEssInput(answers: Map<string, unknown>): EssInput {
  const input = Object.fromEntries(
    ESS_FIELDS.map((field) => [field, null])
  ) as unknown as EssInput;

  for (const key of ESS_QUESTION_KEYS) {
    const field = ESS_KEY_TO_FIELD[key];

    if (!field) {
      // A question was added to lib/ess.ts without a scoring field. Failing
      // loudly is the point: silently skipping it would understate the score
      // of a patient who answered it.
      throw new Error(
        `ESS question "${key}" has no scoring field. Add it to ESS_KEY_TO_FIELD.`
      );
    }

    input[field] = parseItemScore(answers.get(key));
  }

  return input;
}

export interface ScoreEssOutcome {
  result: EssResult;
  /** Exactly what was fed to the scoring function — stored for auditability. */
  input: EssInput;
  /** ESS flag types raised (or still standing) for this session after scoring. */
  activeFlagTypes: string[];
}

/**
 * Computes an ESS score for one session and writes it to
 * `questionnaire_scores`.
 *
 * Everything said about authorization in scoreAndSaveStopBangSession applies
 * here unchanged: this uses the service-role client, which bypasses RLS, so it
 * must only be called from a route that has already proved — through the
 * patient's own client — that the caller owns the session.
 *
 * The two instruments write separate rows, keyed by the `unique (session_id,
 * instrument)` constraint, and reconcile separate sets of safety flags. A
 * patient can therefore hold a standard OSA-risk flag and an urgent
 * drowsy-driving flag at the same time, and re-submitting either questionnaire
 * leaves the other's flags untouched.
 */
export async function scoreAndSaveEssSession(
  sessionId: string
): Promise<ScoreEssOutcome> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new MissingServiceRoleKeyError();
  }

  const admin = createAdminClient();

  const { data: session, error: sessionError } = await admin
    .from("intake_sessions")
    .select("id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(
      `Cannot score: intake session not found (${sessionError?.message ?? "no row"})`
    );
  }

  const { data: responses, error: responsesError } = await admin
    .from("intake_responses")
    .select("question_key, answer_value")
    .eq("session_id", sessionId)
    .in("question_key", ESS_QUESTION_KEYS);

  if (responsesError) {
    throw new Error(`Cannot score: ${responsesError.message}`);
  }

  const answers = new Map<string, unknown>(
    (responses ?? []).map((row) => [row.question_key, row.answer_value])
  );

  const input = buildEssInput(answers);
  const result = scoreEss(input);

  // `risk_category` holds each instrument's own vocabulary: 'low' /
  // 'intermediate' / 'high' for STOP-BANG, 'normal' / 'mild' / 'moderate' /
  // 'severe' for ESS. The column is free text precisely so neither instrument
  // has to be squeezed into the other's bands, which would misreport both.
  const { error: saveError } = await admin.from("questionnaire_scores").upsert(
    {
      session_id: sessionId,
      instrument: "ESS",
      raw_answers: input,
      score: result.score,
      score_breakdown: {
        breakdown: result.breakdown,
        answeredCount: result.answeredCount,
        incomplete: result.incomplete,
        maxPossibleScore: result.maxPossibleScore,
      },
      risk_category: result.severity,
      computed_by: "deterministic_engine",
      computed_at: new Date().toISOString(),
    },
    { onConflict: "session_id,instrument" }
  );

  if (saveError) {
    throw new Error(`Failed to save score: ${saveError.message}`);
  }

  const activeFlagTypes = await syncSafetyFlags(
    admin,
    sessionId,
    detectEssSafetyFlags(result),
    ESS_FLAG_TYPES
  );

  return { result, input, activeFlagTypes };
}

// ---------------------------------------------------------------------------
// Insomnia Severity Index
// ---------------------------------------------------------------------------

/**
 * Maps each stored question key to the field the scoring engine expects.
 * Same reasoning as ESS_KEY_TO_FIELD above: this is the one place that knows
 * both the database's keys and the scorer's field names.
 */
const ISI_KEY_TO_FIELD: Record<string, IsiField> = {
  isi_falling_asleep: "fallingAsleep",
  isi_staying_asleep: "stayingAsleep",
  isi_waking_early: "wakingEarly",
  isi_dissatisfaction: "sleepDissatisfaction",
  isi_noticeable: "noticeableToOthers",
  isi_worried: "worriedAboutSleep",
  isi_interference: "interferesWithDay",
};

function buildIsiInput(answers: Map<string, unknown>): IsiInput {
  const input = Object.fromEntries(
    ISI_FIELDS.map((field) => [field, null])
  ) as unknown as IsiInput;

  for (const key of ISI_QUESTION_KEYS) {
    const field = ISI_KEY_TO_FIELD[key];

    if (!field) {
      throw new Error(
        `ISI question "${key}" has no scoring field. Add it to ISI_KEY_TO_FIELD.`
      );
    }

    input[field] = parseIsiItemScore(answers.get(key));
  }

  return input;
}

/**
 * Three outcomes, and none of them is "a score of 0 because nobody answered".
 *
 * The names are deliberately the same as three of the four states in `IsiView`
 * (see service.ts), because this engine is what decides which of them the
 * clinician will see:
 *
 *   no_symptoms       — screening answered 'no'. No score row; any old one is
 *                       deleted.
 *   symptoms_reported — screening answered 'yes', but not one of the seven
 *                       items has been answered yet. Also no score row, for
 *                       exactly the same reason: an instrument nobody has
 *                       answered has no total. A 0 written here would reach the
 *                       clinician as "ISI 0 — no insomnia" for a patient who
 *                       has just said the opposite.
 *   scored            — at least one item answered, so there is a real total,
 *                       marked incomplete if fewer than seven.
 *
 * The fourth view state, `not_screened`, cannot originate here: this function
 * only ever runs after a save, and the route rejects a save with no screening
 * answer.
 */
export type ScoreIsiOutcome =
  | { state: "no_symptoms" }
  | { state: "symptoms_reported" }
  | { state: "scored"; result: IsiResult; input: IsiInput };

/**
 * Computes an ISI score for one session, or records that there is nothing to
 * score.
 *
 * Authorization is the same as the other two engines: this uses the
 * service-role client and bypasses RLS, so it must only be called from a route
 * that has already proved, through the patient's own client, that the caller
 * owns the session.
 *
 * TWO THINGS ARE DIFFERENT FROM ESS AND STOP-BANG.
 *
 * First, there are two ways for this instrument to end up with no score row —
 * and in both of them an existing row is DELETED, not merely left unwritten.
 * A patient who answers the seven items and then goes back and either says
 * they have no insomnia symptoms, or clears every item, would otherwise leave
 * a stale score behind; a stale clinical score is worse than a missing one
 * because nothing marks it as out of date. The screening answer itself stays
 * in `intake_responses` either way, so the clinician still sees that the
 * question was asked and what the patient said.
 *
 * Second, this instrument raises no safety flags, so syncSafetyFlags is never
 * called here. See the note on ISI_FLAG_TYPES for why that is a decision
 * rather than an omission. Because it is never called, ISI cannot disturb the
 * flags the other two instruments own.
 */
export async function scoreAndSaveIsiSession(
  sessionId: string
): Promise<ScoreIsiOutcome> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new MissingServiceRoleKeyError();
  }

  const admin = createAdminClient();

  const { data: session, error: sessionError } = await admin
    .from("intake_sessions")
    .select("id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(
      `Cannot score: intake session not found (${sessionError?.message ?? "no row"})`
    );
  }

  const { data: responses, error: responsesError } = await admin
    .from("intake_responses")
    .select("question_key, answer_value")
    .eq("session_id", sessionId)
    .in("question_key", [...ISI_QUESTION_KEYS, ISI_SCREENING_QUESTION_KEY]);

  if (responsesError) {
    throw new Error(`Cannot score: ${responsesError.message}`);
  }

  const answers = new Map<string, unknown>(
    (responses ?? []).map((row) => [row.question_key, row.answer_value])
  );

  // Only an explicit false screens the instrument out. A missing answer means
  // the patient has not reached the question yet, which is not the same as
  // saying no, and must not silently discard a score.
  if (answers.get(ISI_SCREENING_QUESTION_KEY) === false) {
    await clearIsiScore(admin, sessionId);
    return { state: "no_symptoms" };
  }

  const input = buildIsiInput(answers);
  const result = scoreIsi(input);

  // Reported symptoms, answered nothing. Treated exactly like the screened-out
  // case as far as the database is concerned — no row, and any previous row
  // removed — because the alternative is a stored 0 with risk_category 'none',
  // which the clinician's screen would render as "ISI 0 / 28" for a patient
  // who has just reported insomnia. The patient's 'yes' is not lost: it lives
  // in `intake_responses`, and readIsiView turns a screening 'yes' with no
  // score row into the `symptoms_reported` state.
  if (result.answeredCount === 0) {
    await clearIsiScore(admin, sessionId);
    return { state: "symptoms_reported" };
  }

  // `risk_category` carries this instrument's own vocabulary, as it does for
  // the other two: 'none' / 'subthreshold' / 'moderate' / 'severe'.
  const { error: saveError } = await admin.from("questionnaire_scores").upsert(
    {
      session_id: sessionId,
      instrument: "ISI",
      raw_answers: input,
      score: result.score,
      score_breakdown: {
        breakdown: result.breakdown,
        answeredCount: result.answeredCount,
        incomplete: result.incomplete,
        maxPossibleScore: result.maxPossibleScore,
      },
      risk_category: result.severity,
      computed_by: "deterministic_engine",
      computed_at: new Date().toISOString(),
    },
    { onConflict: "session_id,instrument" }
  );

  if (saveError) {
    throw new Error(`Failed to save score: ${saveError.message}`);
  }

  return { state: "scored", result, input };
}

/**
 * Removes this session's ISI score row, if there is one.
 *
 * Shared by the two "nothing to score" paths so they cannot drift apart. A
 * delete that only ran on one of them would leave a stale total behind on the
 * other, which is the precise failure this whole design is trying to avoid.
 */
async function clearIsiScore(admin: AdminClient, sessionId: string) {
  const { error } = await admin
    .from("questionnaire_scores")
    .delete()
    .eq("session_id", sessionId)
    .eq("instrument", "ISI");

  if (error) {
    throw new Error(`Failed to clear ISI score: ${error.message}`);
  }
}
