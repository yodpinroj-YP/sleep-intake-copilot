/**
 * STOP-BANG scoring — deterministic, rule-based, and deliberately pure.
 *
 * Nothing in this file touches the database, the network, or an LLM. It takes
 * plain values in and returns a plain result out, which is what makes it
 * testable: every rule below is covered by stopbang-scoring.test.ts.
 *
 * Why that matters here more than usual: a wrong score is a clinical error.
 * A patient scored 4 instead of 6 may not be referred for a sleep study they
 * needed. So the rules live in one small file with no dependencies, and the
 * tests are the contract.
 *
 * NOTE ON THRESHOLDS: the cut-offs below are the ones most commonly reported
 * for STOP-BANG, but variants exist (some use a neck circumference of 43 cm
 * for men and 41 cm for women instead of a single 40 cm). They are exported as
 * named constants so a sleep physician can review and change them in one place
 * without reading the scoring logic.
 */

/** BMI above this scores the "B" item. */
export const BMI_THRESHOLD = 35;
/** Age above this scores the "A" item. */
export const AGE_THRESHOLD_YEARS = 50;
/** Neck circumference (cm) above this scores the "N" item. */
export const NECK_THRESHOLD_CM = 40;

/** Score at or above this is high risk. */
export const HIGH_RISK_CUTOFF = 5;
/** Score at or above this (and below HIGH_RISK_CUTOFF) is intermediate risk. */
export const INTERMEDIATE_RISK_CUTOFF = 3;

export type StopBangLetter = "S" | "T" | "O" | "P" | "B" | "A" | "N" | "G";
export type RiskCategory = "low" | "intermediate" | "high";

export interface StopBangInput {
  /** Answers to the four questionnaire items. null = not answered. */
  snoring: boolean | null;
  tired: boolean | null;
  observedApnea: boolean | null;
  pressure: boolean | null;
  /** Derived values. null = the underlying data is missing. */
  bmi: number | null;
  ageYears: number | null;
  neckCircumferenceCm: number | null;
  sex: "male" | "female" | "other" | null;
}

export interface StopBangItem {
  letter: StopBangLetter;
  /** Short identifier for the clinician-facing breakdown. */
  label: string;
  /** Did this item contribute a point? */
  scored: boolean;
  /** Did we have the data needed to decide? */
  answered: boolean;
}

export interface StopBangResult {
  /** 0–8. Only counts items we actually had data for. */
  score: number;
  /** How many of the 8 items had data. */
  answeredCount: number;
  riskCategory: RiskCategory;
  /**
   * True when at least one item had no data. An incomplete score is a FLOOR,
   * not a final answer: a score of 4 with two items missing could really be 6.
   * The clinician-facing UI must say so rather than presenting the number as
   * if the assessment were complete.
   */
  incomplete: boolean;
  /**
   * The highest score this patient could still reach once the missing items
   * are filled in. Equal to `score` when nothing is missing.
   */
  maxPossibleScore: number;
  breakdown: StopBangItem[];
}

/**
 * Whole years between a date of birth and a reference date.
 *
 * Handles the case people usually get wrong: someone born on 31 December is
 * not a year older on 1 January. Returns null for a missing or unparseable
 * date rather than guessing an age.
 */
export function calculateAgeYears(
  dateOfBirth: string | null,
  asOf: Date = new Date()
): number | null {
  if (!dateOfBirth) return null;

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  if (dob > asOf) return null;

  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();

  const monthDiff = asOf.getUTCMonth() - dob.getUTCMonth();
  const dayDiff = asOf.getUTCDate() - dob.getUTCDate();

  // Birthday hasn't happened yet this year.
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}

/**
 * Scores one item from a yes/no answer. A null answer means "we don't know",
 * which is different from "no" — it scores nothing but is not counted as
 * answered, so the caller can tell a real 0 from a gap in the data.
 */
function scoreBooleanItem(
  letter: StopBangLetter,
  label: string,
  answer: boolean | null
): StopBangItem {
  return {
    letter,
    label,
    scored: answer === true,
    answered: answer !== null && answer !== undefined,
  };
}

/**
 * Scores one item from a measurement compared against a threshold. A null or
 * non-finite measurement counts as unanswered.
 */
function scoreThresholdItem(
  letter: StopBangLetter,
  label: string,
  value: number | null,
  threshold: number
): StopBangItem {
  const answered = value !== null && value !== undefined && Number.isFinite(value);
  return {
    letter,
    label,
    scored: answered && (value as number) > threshold,
    answered,
  };
}

export function scoreStopBang(input: StopBangInput): StopBangResult {
  const breakdown: StopBangItem[] = [
    scoreBooleanItem("S", "Snoring", input.snoring),
    scoreBooleanItem("T", "Tired", input.tired),
    scoreBooleanItem("O", "Observed apnea", input.observedApnea),
    scoreBooleanItem("P", "High blood pressure", input.pressure),
    scoreThresholdItem("B", `BMI > ${BMI_THRESHOLD}`, input.bmi, BMI_THRESHOLD),
    scoreThresholdItem(
      "A",
      `Age > ${AGE_THRESHOLD_YEARS}`,
      input.ageYears,
      AGE_THRESHOLD_YEARS
    ),
    scoreThresholdItem(
      "N",
      `Neck > ${NECK_THRESHOLD_CM} cm`,
      input.neckCircumferenceCm,
      NECK_THRESHOLD_CM
    ),
    {
      letter: "G",
      label: "Male",
      scored: input.sex === "male",
      // "other" is a real answer that simply doesn't score, unlike null.
      answered: input.sex !== null && input.sex !== undefined,
    },
  ];

  const score = breakdown.filter((item) => item.scored).length;
  const answeredCount = breakdown.filter((item) => item.answered).length;
  const unansweredCount = breakdown.length - answeredCount;

  return {
    score,
    answeredCount,
    riskCategory: categoriseRisk(score),
    incomplete: unansweredCount > 0,
    maxPossibleScore: score + unansweredCount,
    breakdown,
  };
}

export function categoriseRisk(score: number): RiskCategory {
  if (score >= HIGH_RISK_CUTOFF) return "high";
  if (score >= INTERMEDIATE_RISK_CUTOFF) return "intermediate";
  return "low";
}

// ---------------------------------------------------------------------------
// Safety flags
// ---------------------------------------------------------------------------

/** Stable identifier for the high-OSA-risk flag. Never translate or reuse. */
export const HIGH_OSA_RISK_FLAG = "high_osa_risk";

export interface SafetyFlagCandidate {
  flagType: string;
  severity: "standard" | "urgent";
  /** Human-readable reason, stored so a clinician can see WHY it fired. */
  triggerSource: string;
}

/**
 * Decides which safety flags a STOP-BANG result should raise.
 *
 * Kept pure and separate from the database for the same reason as the scoring
 * itself: a flag that fires when it shouldn't (or fails to fire when it
 * should) is a clinical problem, so the rule has to be testable in isolation.
 *
 * Only one rule exists so far, deliberately. The other flags worth having —
 * falling asleep while driving, severe daytime sleepiness on ESS — depend on
 * questions this intake doesn't ask yet. Adding a rule here that silently
 * never fires would be worse than not having it.
 *
 * Note this reads `score`, which is a FLOOR when data is missing. A patient
 * sitting at 4 with two unanswered items may well be high risk once those are
 * filled in; they are not flagged, and the clinician view has to show the
 * "incomplete" state so that gap is visible rather than read as a clean low
 * score.
 */
export function detectSafetyFlags(
  result: StopBangResult
): SafetyFlagCandidate[] {
  const flags: SafetyFlagCandidate[] = [];

  if (result.score >= HIGH_RISK_CUTOFF) {
    flags.push({
      flagType: HIGH_OSA_RISK_FLAG,
      // 'standard' rather than 'urgent': a high screening score warrants a
      // sleep study, not a same-day intervention. 'urgent' is reserved for
      // findings that need someone contacted today, such as drowsy driving.
      severity: "standard",
      triggerSource: `STOP-BANG score ${result.score}/8 (cut-off ${HIGH_RISK_CUTOFF})`,
    });
  }

  return flags;
}
