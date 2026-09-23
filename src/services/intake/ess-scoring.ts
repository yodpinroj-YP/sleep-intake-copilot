/**
 * Epworth Sleepiness Scale scoring — deterministic, rule-based, and pure.
 *
 * Same contract as stopbang-scoring.ts: nothing in this file touches the
 * database, the network, or an LLM. Plain values in, plain result out, every
 * rule covered by ess-scoring.test.ts.
 *
 * IMPORTS ARE DELIBERATELY ABSENT. The test runner (`node --test` with native
 * type-stripping) resolves real file paths, not the TypeScript `@/` alias, so
 * a scoring file that imported from `@/lib/...` would stop being testable. The
 * question wording lives in lib/ess.ts; this file never needs it, because the
 * caller hands it named values rather than a bag of question keys.
 *
 * NOTE ON THRESHOLDS: ESS bands are conventionally 0–10 normal, 11–12 mild,
 * 13–15 moderate, 16–24 severe. They are exported as named constants so a
 * sleep physician can review and change them in one place without reading the
 * scoring logic.
 */

/** Each item is scored 0–3, so eight items run 0–24. */
export const ESS_MAX_ITEM_SCORE = 3;
export const ESS_ITEM_COUNT = 8;
export const ESS_MAX_TOTAL_SCORE = ESS_MAX_ITEM_SCORE * ESS_ITEM_COUNT;

/** Score at or above this is mild excessive daytime sleepiness. */
export const MILD_SLEEPINESS_CUTOFF = 11;
/** Score at or above this (and below severe) is moderate. */
export const MODERATE_SLEEPINESS_CUTOFF = 13;
/** Score at or above this is severe. */
export const SEVERE_SLEEPINESS_CUTOFF = 16;

export type EssItemScore = 0 | 1 | 2 | 3;
export type EssSeverity = "normal" | "mild" | "moderate" | "severe";

/**
 * One answer per item. null means the patient has not answered it yet, which
 * is deliberately different from 0 ("would never doze") — see EssResult.
 */
export interface EssInput {
  sittingReading: EssItemScore | null;
  watchingTv: EssItemScore | null;
  sittingPublic: EssItemScore | null;
  passengerCar: EssItemScore | null;
  lyingAfternoon: EssItemScore | null;
  sittingTalking: EssItemScore | null;
  afterLunch: EssItemScore | null;
  /**
   * Dozing while stopped in traffic. Named rather than indexed because it
   * carries a safety rule of its own — see detectEssSafetyFlags.
   */
  inCarTraffic: EssItemScore | null;
}

/** The field names above, in the order the questionnaire presents them. */
export const ESS_FIELDS = [
  "sittingReading",
  "watchingTv",
  "sittingPublic",
  "passengerCar",
  "lyingAfternoon",
  "sittingTalking",
  "afterLunch",
  "inCarTraffic",
] as const;

export type EssField = (typeof ESS_FIELDS)[number];

const ESS_LABELS: Record<EssField, string> = {
  sittingReading: "Sitting and reading",
  watchingTv: "Watching TV",
  sittingPublic: "Sitting inactive in public",
  passengerCar: "Passenger in a car for an hour",
  lyingAfternoon: "Lying down in the afternoon",
  sittingTalking: "Sitting and talking",
  afterLunch: "Sitting quietly after lunch",
  inCarTraffic: "Stopped in traffic",
};

export interface EssItem {
  field: EssField;
  /** Item position 1–8, for display. */
  position: number;
  label: string;
  /** 0–3, or null when the item has not been answered. */
  score: EssItemScore | null;
  answered: boolean;
}

export interface EssResult {
  /** 0–24. Only sums items that were actually answered. */
  score: number;
  /** How many of the 8 items had an answer. */
  answeredCount: number;
  severity: EssSeverity;
  /**
   * True when at least one item is unanswered. As with STOP-BANG, an
   * incomplete total is a FLOOR, not a final answer — but the gap is wider
   * here: each missing ESS item can still add up to 3 points, so a score of 9
   * with three items missing could really be 18, which is severe. The
   * clinician-facing UI must say so rather than presenting the number as if
   * the questionnaire were finished.
   */
  incomplete: boolean;
  /** The highest total still reachable once the missing items are filled in. */
  maxPossibleScore: number;
  breakdown: EssItem[];
}

/**
 * Accepts a stored answer only if it is one of the four valid item scores.
 *
 * Anything else — a string, a decimal, 4, a negative — is treated as "not
 * answered" rather than coerced. A questionnaire that silently rounds bad
 * input into a clinical score is worse than one that reports a gap.
 */
export function parseItemScore(value: unknown): EssItemScore | null {
  if (value === 0 || value === 1 || value === 2 || value === 3) {
    return value;
  }
  return null;
}

export function scoreEss(input: EssInput): EssResult {
  const breakdown: EssItem[] = ESS_FIELDS.map((field, index) => {
    const raw = parseItemScore(input[field]);
    return {
      field,
      position: index + 1,
      label: ESS_LABELS[field],
      score: raw,
      answered: raw !== null,
    };
  });

  const score = breakdown.reduce((sum, item) => sum + (item.score ?? 0), 0);
  const answeredCount = breakdown.filter((item) => item.answered).length;
  const unansweredCount = breakdown.length - answeredCount;

  return {
    score,
    answeredCount,
    severity: categoriseSleepiness(score),
    incomplete: unansweredCount > 0,
    maxPossibleScore: score + unansweredCount * ESS_MAX_ITEM_SCORE,
    breakdown,
  };
}

export function categoriseSleepiness(score: number): EssSeverity {
  if (score >= SEVERE_SLEEPINESS_CUTOFF) return "severe";
  if (score >= MODERATE_SLEEPINESS_CUTOFF) return "moderate";
  if (score >= MILD_SLEEPINESS_CUTOFF) return "mild";
  return "normal";
}

// ---------------------------------------------------------------------------
// Safety flags
// ---------------------------------------------------------------------------

/** Stable identifiers. Never translate or reuse. */
export const SEVERE_SLEEPINESS_FLAG = "severe_sleepiness";
export const DROWSY_DRIVING_FLAG = "drowsy_driving";

/**
 * Every flag type the ESS engine owns.
 *
 * This list exists so the persistence layer can reconcile ESS flags without
 * touching flags another instrument raised. Without it, re-submitting
 * STOP-BANG would withdraw the ESS flags and vice versa.
 */
export const ESS_FLAG_TYPES = [
  SEVERE_SLEEPINESS_FLAG,
  DROWSY_DRIVING_FLAG,
] as const;

export interface SafetyFlagCandidate {
  flagType: string;
  severity: "standard" | "urgent";
  triggerSource: string;
}

/**
 * Decides which safety flags an ESS result should raise.
 *
 * TWO RULES, AND THEY ARE NOT THE SAME KIND OF RULE.
 *
 * 1. Severe sleepiness (total ≥ 16). Raised as 'standard'. Note the cut-off is
 *    16, not 11: a score above 10 means excessive daytime sleepiness, which is
 *    the reason a large share of these patients are in clinic at all. Flagging
 *    every one of them would make the flag column meaningless, and a flag
 *    nobody can act on is noise that hides the flags that matter.
 *
 * 2. Dozing while stopped in traffic (that single item = 3). Raised as
 *    'urgent', and INDEPENDENTLY OF THE TOTAL. This is the case the severity
 *    enum was built for: a patient who is highly likely to doze at the wheel
 *    is a danger today, not at their next appointment, and someone should
 *    contact them. A patient can reach a total of 9 — comfortably "normal" —
 *    while answering 3 to this item, so a rule keyed on the total would miss
 *    exactly the person it most needed to catch.
 *
 * The standard ESS does not ask whether the patient drives, so this rule
 * cannot know. It fires anyway and leaves the judgement to the clinician, who
 * acknowledges the flag: a false alarm costs one conversation, a missed one
 * costs considerably more.
 *
 * As with STOP-BANG, rule 1 reads `score`, which is a floor when data is
 * missing. A patient sitting at 14 with two unanswered items may well be
 * severe; they are not flagged, and the clinician view has to show the
 * "incomplete" state so that gap stays visible.
 */
export function detectEssSafetyFlags(result: EssResult): SafetyFlagCandidate[] {
  const flags: SafetyFlagCandidate[] = [];

  if (result.score >= SEVERE_SLEEPINESS_CUTOFF) {
    flags.push({
      flagType: SEVERE_SLEEPINESS_FLAG,
      severity: "standard",
      triggerSource: `ESS score ${result.score}/${ESS_MAX_TOTAL_SCORE} (cut-off ${SEVERE_SLEEPINESS_CUTOFF})`,
    });
  }

  const driving = result.breakdown.find(
    (item) => item.field === "inCarTraffic"
  );

  if (driving?.score === ESS_MAX_ITEM_SCORE) {
    flags.push({
      flagType: DROWSY_DRIVING_FLAG,
      severity: "urgent",
      triggerSource: `ESS item 8 (stopped in traffic) = ${ESS_MAX_ITEM_SCORE}/${ESS_MAX_ITEM_SCORE}`,
    });
  }

  return flags;
}
