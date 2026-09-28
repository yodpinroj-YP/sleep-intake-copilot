/**
 * Insomnia Severity Index scoring — deterministic, rule-based, and pure.
 *
 * Same contract as stopbang-scoring.ts and ess-scoring.ts: nothing here touches
 * the database, the network, or an LLM. Plain values in, plain result out,
 * every rule covered by isi-scoring.test.ts.
 *
 * IMPORTS ARE DELIBERATELY ABSENT, for the same reason as the other two
 * scoring files: `node --test` resolves real paths, not the `@/` alias. Item
 * wording lives in lib/isi.ts and never reaches this file.
 *
 * WHAT THIS INSTRUMENT ADDS. STOP-BANG asks about a breathing problem during
 * sleep and ESS asks about its daytime consequence. Neither asks whether the
 * patient can sleep at all. A patient can score 0 on both and still be awake
 * at 3am every night, which is a different disorder with a different treatment
 * path — so this is a third axis, not a finer reading of the first two.
 *
 * NOTE ON THRESHOLDS: the published bands are 0–7 no clinically significant
 * insomnia, 8–14 subthreshold, 15–21 clinical insomnia of moderate severity,
 * 22–28 clinical insomnia, severe. Exported as named constants so a sleep
 * physician can review them in one place without reading the scoring logic.
 */

/** Each item is scored 0–4, so seven items run 0–28. */
export const ISI_MAX_ITEM_SCORE = 4;
export const ISI_ITEM_COUNT = 7;
export const ISI_MAX_TOTAL_SCORE = ISI_MAX_ITEM_SCORE * ISI_ITEM_COUNT;

/** Score at or above this is subthreshold insomnia. */
export const SUBTHRESHOLD_INSOMNIA_CUTOFF = 8;
/** Score at or above this (and below severe) is clinical insomnia, moderate. */
export const MODERATE_INSOMNIA_CUTOFF = 15;
/** Score at or above this is clinical insomnia, severe. */
export const SEVERE_INSOMNIA_CUTOFF = 22;

export type IsiItemScore = 0 | 1 | 2 | 3 | 4;
export type IsiSeverity = "none" | "subthreshold" | "moderate" | "severe";

/**
 * One answer per item. null means the patient has not answered it yet, which
 * is deliberately different from 0 — on this instrument 0 is an active
 * statement ("no difficulty at all", "very satisfied"), not an absence.
 */
export interface IsiInput {
  /** Items 1–3: severity of each insomnia symptom over the last two weeks. */
  fallingAsleep: IsiItemScore | null;
  stayingAsleep: IsiItemScore | null;
  wakingEarly: IsiItemScore | null;
  /** Item 4: dissatisfaction with the current sleep pattern. */
  sleepDissatisfaction: IsiItemScore | null;
  /** Items 5–7: the impact of the problem, not the symptom itself. */
  noticeableToOthers: IsiItemScore | null;
  worriedAboutSleep: IsiItemScore | null;
  interferesWithDay: IsiItemScore | null;
}

/** The field names above, in the order the questionnaire presents them. */
export const ISI_FIELDS = [
  "fallingAsleep",
  "stayingAsleep",
  "wakingEarly",
  "sleepDissatisfaction",
  "noticeableToOthers",
  "worriedAboutSleep",
  "interferesWithDay",
] as const;

export type IsiField = (typeof ISI_FIELDS)[number];

const ISI_LABELS: Record<IsiField, string> = {
  fallingAsleep: "Difficulty falling asleep",
  stayingAsleep: "Difficulty staying asleep",
  wakingEarly: "Waking too early",
  sleepDissatisfaction: "Dissatisfied with sleep pattern",
  noticeableToOthers: "Noticeable to others",
  worriedAboutSleep: "Worried about sleep",
  interferesWithDay: "Interferes with daily functioning",
};

export interface IsiItem {
  field: IsiField;
  /** Item position 1–7, for display. */
  position: number;
  label: string;
  /** 0–4, or null when the item has not been answered. */
  score: IsiItemScore | null;
  answered: boolean;
}

export interface IsiResult {
  /** 0–28. Only sums items that were actually answered. */
  score: number;
  /** How many of the 7 items had an answer. */
  answeredCount: number;
  severity: IsiSeverity;
  /**
   * True when at least one item is unanswered. The total is then a FLOOR, and
   * the gap is wider here than on either earlier instrument: each missing item
   * can still add 4 points, so 11 with three items missing could really be 23,
   * which is severe clinical insomnia. The clinician-facing UI must say so.
   */
  incomplete: boolean;
  /** The highest total still reachable once the missing items are filled in. */
  maxPossibleScore: number;
  breakdown: IsiItem[];
}

/**
 * Accepts a stored answer only if it is one of the five valid item scores.
 *
 * Anything else — a string, a decimal, 5, a negative — is treated as "not
 * answered" rather than coerced, for the same reason as on the other two
 * instruments: a questionnaire that silently rounds bad input into a clinical
 * score is worse than one that reports a gap.
 *
 * Note the range differs from ESS. ISI runs 0–4, ESS runs 0–3, and a shared
 * parser would have quietly accepted a 4 as an ESS answer. Hence two parsers.
 */
export function parseItemScore(value: unknown): IsiItemScore | null {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  return null;
}

export function scoreIsi(input: IsiInput): IsiResult {
  const breakdown: IsiItem[] = ISI_FIELDS.map((field, index) => {
    const raw = parseItemScore(input[field]);
    return {
      field,
      position: index + 1,
      label: ISI_LABELS[field],
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
    severity: categoriseInsomnia(score),
    incomplete: unansweredCount > 0,
    maxPossibleScore: score + unansweredCount * ISI_MAX_ITEM_SCORE,
    breakdown,
  };
}

export function categoriseInsomnia(score: number): IsiSeverity {
  if (score >= SEVERE_INSOMNIA_CUTOFF) return "severe";
  if (score >= MODERATE_INSOMNIA_CUTOFF) return "moderate";
  if (score >= SUBTHRESHOLD_INSOMNIA_CUTOFF) return "subthreshold";
  return "none";
}

// ---------------------------------------------------------------------------
// Safety flags — deliberately none
// ---------------------------------------------------------------------------

/**
 * ISI raises no safety flags, and the empty list is the record of that
 * decision rather than an oversight.
 *
 * The reasoning, from the sleep physician on the project: severe insomnia is a
 * reason to treat, not a reason to contact the patient before their
 * appointment. The one flag this system raises urgently — dozing at the wheel
 * — describes a danger happening now, to other people as well as the patient.
 * Nothing the ISI measures is that.
 *
 * The cost of getting this wrong is not a missing feature, it is a flag column
 * that fills with cases nobody can act on today. Once a flag is routine it is
 * skimmed, and then the drowsy-driving flag it sits next to is skimmed too.
 *
 * The persistence layer therefore never calls the flag reconciler for this
 * instrument. If ISI ever does own a flag, add it here and pass this list to
 * syncSafetyFlags — passing an empty list would delete nothing but would also
 * mean nothing.
 */
export const ISI_FLAG_TYPES = [] as const;
