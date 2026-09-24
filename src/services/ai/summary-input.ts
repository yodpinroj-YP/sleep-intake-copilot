/**
 * Builds the payload that gets sent to the language model — and nothing else.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * No identifying information about a patient ever leaves this system in a
 * prompt. Not a name, not a hospital number, not a date of birth, not a phone
 * number, and not free text the patient typed themselves.
 *
 * The reason is practical, not ceremonial. Today the data is synthetic and the
 * model runs on a free tier whose terms allow the provider to use prompts for
 * product improvement. The day this system sees a real patient, that tier has
 * to be replaced — but the far more valuable property is this: because the
 * prompt carries no identifiers, what leaves the network is a set of numbers
 * that belongs to nobody in particular. A hospital IT department reviewing the
 * outbound traffic sees exactly that, and the conversation about whether this
 * is safe becomes a short one.
 *
 * Retrofitting this later is expensive and unprovable — you can rewrite the
 * prompt, but you can never demonstrate that nothing identifying was sent
 * before you did. So it is written now, while the cost is one afternoon.
 * ---------------------------------------------------------------------------
 *
 * IMPORTS ARE DELIBERATELY ABSENT, for the same reason as the scoring engines:
 * `node --test` resolves real paths, not the TypeScript `@/` alias, so a file
 * that imported from `@/lib/...` would stop being testable.
 */

/** Age is reported as a decade band, never as a birth date or exact age. */
export type AgeBand =
  | "under_30"
  | "30_39"
  | "40_49"
  | "50_59"
  | "60_69"
  | "70_79"
  | "80_plus";

/**
 * Why a band and not the number: age, sex and BMI together can single out one
 * person in a small clinic. A decade band keeps everything the summary
 * actually needs — the STOP-BANG age item, and the clinical context of "this
 * is an older patient" — while removing the precision that re-identifies.
 */
export function toAgeBand(ageYears: number | null): AgeBand | null {
  if (ageYears === null || !Number.isFinite(ageYears) || ageYears < 0) {
    return null;
  }
  if (ageYears < 30) return "under_30";
  if (ageYears < 40) return "30_39";
  if (ageYears < 50) return "40_49";
  if (ageYears < 60) return "50_59";
  if (ageYears < 70) return "60_69";
  if (ageYears < 80) return "70_79";
  return "80_plus";
}

export interface SummaryStopBang {
  score: number;
  maxPossibleScore: number;
  incomplete: boolean;
  answeredCount: number;
  riskCategory: string | null;
  items: { letter: string; label: string; scored: boolean; answered: boolean }[];
}

export interface SummaryEss {
  score: number;
  maxPossibleScore: number;
  incomplete: boolean;
  answeredCount: number;
  severity: string | null;
  items: { position: number; label: string; score: number | null; answered: boolean }[];
}

export interface SummaryFlag {
  type: string;
  severity: "standard" | "urgent";
  reason: string;
}

/**
 * Everything the model is allowed to see. This is an allowlist, not a filter:
 * a new field reaches the prompt only if someone adds it here on purpose.
 */
export interface SummaryInput {
  ageBand: AgeBand | null;
  sex: "male" | "female" | "other" | null;
  bmi: number | null;
  neckCircumferenceCm: number | null;
  stopBang: SummaryStopBang | null;
  ess: SummaryEss | null;
  flags: SummaryFlag[];
}

/** The raw values the caller has on hand, identifiers included. */
export interface SummarySource {
  ageYears: number | null;
  sex: "male" | "female" | "other" | null;
  bmi: number | null;
  neckCircumferenceCm: number | null;
  stopBang: SummaryStopBang | null;
  ess: SummaryEss | null;
  flags: SummaryFlag[];
}

/** Rounds a measurement to one decimal place, or returns null. */
function roundMeasurement(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/**
 * Assembles the model's input from the values the caller supplies.
 *
 * NOTE WHAT IS NOT HERE. `chief_complaint` is free text the patient typed, and
 * free text is where identifiers hide — "my husband Somchai noticed I stop
 * breathing" names someone in one sentence. Version 1 therefore excludes it
 * entirely. Including it safely needs its own de-identification pass, which is
 * a real piece of work and not something to bolt on before a deadline.
 */
export function buildSummaryInput(source: SummarySource): SummaryInput {
  return {
    ageBand: toAgeBand(source.ageYears),
    sex: source.sex,
    bmi: roundMeasurement(source.bmi),
    neckCircumferenceCm: roundMeasurement(source.neckCircumferenceCm),
    stopBang: source.stopBang,
    ess: source.ess,
    flags: source.flags,
  };
}

// ---------------------------------------------------------------------------
// Runtime guard
// ---------------------------------------------------------------------------

/** Identifying values the caller holds, to be checked against the payload. */
export interface PatientIdentifiers {
  fullName?: string | null;
  hospitalNumber?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
}

export class IdentifierLeakError extends Error {
  constructor(field: string) {
    super(
      `Refusing to send prompt: it contains the patient's ${field}. ` +
        `Identifying data must never reach the language model — see summary-input.ts.`
    );
    this.name = "IdentifierLeakError";
  }
}

/**
 * Last line of defence before a prompt goes out.
 *
 * The allowlist above should make a leak impossible, but "should" is not a
 * guarantee once several people are editing the code. This checks the actual
 * serialised payload against the actual identifiers of the actual patient, and
 * throws rather than sending. A summary that fails to generate is a visible
 * inconvenience; a name that quietly reaches a third party is not recoverable.
 *
 * Values shorter than three characters are skipped: a one-letter name would
 * match half the payload by coincidence and make the guard useless.
 */
export function assertNoIdentifiers(
  payload: unknown,
  identifiers: PatientIdentifiers
): void {
  const serialised = JSON.stringify(payload ?? {}).toLowerCase();

  const checks: [keyof PatientIdentifiers, string | null | undefined][] = [
    ["fullName", identifiers.fullName],
    ["hospitalNumber", identifiers.hospitalNumber],
    ["dateOfBirth", identifiers.dateOfBirth],
    ["email", identifiers.email],
    ["phone", identifiers.phone],
  ];

  for (const [field, value] of checks) {
    if (typeof value !== "string") continue;

    const needle = value.trim().toLowerCase();
    if (needle.length < 3) continue;

    if (serialised.includes(needle)) {
      throw new IdentifierLeakError(field);
    }
  }
}
