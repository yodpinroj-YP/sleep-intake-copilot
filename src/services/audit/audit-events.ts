/**
 * The vocabulary of the audit log, and the rule about what may be written
 * into an event's `details`.
 *
 * WHY THIS FILE HAS NO IMPORTS
 *
 * Same reason as the scoring engines: the test runner strips TypeScript types
 * but does not resolve the `@/` path alias, so anything it must execute
 * directly has to stand alone. That constraint turns out to suit this file —
 * the rule about what may be logged should not depend on anything.
 */

/**
 * Every action this system is willing to record.
 *
 * This list is duplicated in the check constraint in 0009_audit_log.sql, and
 * the duplication is deliberate: the database refuses an action it has never
 * heard of even if a future version of this file forgets to. Adding an action
 * means changing both, and the migration is the one that matters.
 */
export const AUDIT_ACTIONS = [
  /** A member of the care team was shown a patient's record. */
  "record_viewed",
  /** A member of the care team asked the model for a draft summary. */
  "summary_requested",
  /** A physician accepted a draft into the record. */
  "summary_approved",
  /** A physician rejected a draft. */
  "summary_rejected",
  /** A patient saved answers to a questionnaire. */
  "answers_saved",
  /** A patient removed an answer they had previously given. */
  "answer_retracted",
  /** A patient abandoned and deleted an intake session. */
  "session_deleted",
  /** A patient gave consent for one purpose. */
  "consent_granted",
  /** A patient withdrew consent for one purpose. */
  "consent_withdrawn",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * The only keys that may appear in `details`.
 *
 * THIS IS A PRIVACY BOUNDARY, NOT A SCHEMA CONVENIENCE.
 *
 * An audit log that quietly accumulates answer values, free text or names
 * becomes a second copy of the medical record — one that sits outside every
 * protection built for the first copy, and that this project has just decided
 * to keep forever. So `details` is restricted to facts ABOUT an action:
 * which instrument, how many items, which decision. Never what the patient
 * said.
 *
 * Note what is NOT here and does not need to be: `patientId` and `sessionId`
 * are columns of their own. Identifying whose record was touched is the
 * purpose of this table. The rule being enforced is narrower and more
 * important — the log must not become a place to read clinical content.
 */
export const AUDIT_DETAIL_KEYS = [
  /** 'ESS' | 'STOP_BANG' | 'ISI' — which questionnaire. */
  "instrument",
  /** Question keys, e.g. 'isi_falling_asleep'. Field names, never answers. */
  "questionKeys",
  /** How many items were saved. */
  "answeredCount",
  /** How many stored answers were removed. */
  "retractedCount",
  /** How many patient records were returned by a read. */
  "recordCount",
  /** 'approved' | 'rejected'. */
  "decision",
  /** Which version of a draft summary the decision applied to. */
  "summaryVersion",
  /** The model that produced a draft, e.g. 'gemini-3.5-flash'. */
  "model",
  /** Whether an instrument was screened out rather than answered. */
  "screenedOut",
  /** The session's status at the moment of the action. */
  "sessionStatus",
  /** 'care' | 'ai_summary' | 'research' — which consent was changed. */
  "consentPurpose",
  /**
   * The version of the consent wording that was on screen.
   *
   * Without it the log records that consent changed but not what the patient
   * was looking at when they changed it, which is most of the value.
   */
  "consentTextVersion",
] as const;

export type AuditDetailKey = (typeof AUDIT_DETAIL_KEYS)[number];

/** What a detail value is allowed to be. Objects are excluded on purpose. */
export type AuditDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export type AuditDetails = Partial<Record<AuditDetailKey, AuditDetailValue>>;

/**
 * The longest a logged string may be.
 *
 * Short enough that a chief complaint, a reviewer's note or a sentence a
 * patient typed cannot survive being put here by mistake, and long enough for
 * every legitimate value above — the longest of which is a model name.
 */
export const AUDIT_MAX_STRING_LENGTH = 64;

export class AuditDetailsRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditDetailsRejectedError";
  }
}

/**
 * Throws unless every key is on the allowlist and every value is a short
 * scalar or an array of short strings.
 *
 * Throwing rather than stripping is the point. Silently dropping a key would
 * leave a caller believing it had recorded something it had not, and this is a
 * table whose whole value is that what it says happened, happened.
 */
export function assertAuditDetails(
  details: Record<string, unknown>
): asserts details is AuditDetails {
  const allowed = new Set<string>(AUDIT_DETAIL_KEYS);

  for (const [key, value] of Object.entries(details)) {
    if (!allowed.has(key)) {
      throw new AuditDetailsRejectedError(
        `Audit detail "${key}" is not on the allowlist. Add it to ` +
          `AUDIT_DETAIL_KEYS only if it describes the action rather than the ` +
          `clinical data.`
      );
    }

    assertAuditValue(key, value);
  }
}

function assertAuditValue(key: string, value: unknown): void {
  if (value === null || typeof value === "boolean") return;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AuditDetailsRejectedError(
        `Audit detail "${key}" is not a finite number.`
      );
    }
    return;
  }

  if (typeof value === "string") {
    assertShortString(key, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") {
        throw new AuditDetailsRejectedError(
          `Audit detail "${key}" may only contain strings.`
        );
      }
      assertShortString(key, item);
    }
    return;
  }

  // Nested objects are refused rather than inspected. An allowlist that has to
  // walk arbitrary structures is an allowlist with a hole in it.
  throw new AuditDetailsRejectedError(
    `Audit detail "${key}" must be a string, number, boolean, null or an ` +
      `array of strings.`
  );
}

function assertShortString(key: string, value: string): void {
  if (value.length > AUDIT_MAX_STRING_LENGTH) {
    throw new AuditDetailsRejectedError(
      `Audit detail "${key}" is ${value.length} characters, over the ` +
        `${AUDIT_MAX_STRING_LENGTH} character limit. Long strings are how ` +
        `free text gets into a log that is kept forever.`
    );
  }
}

/** One thing that happened, as it will be stored. */
export interface AuditEvent {
  action: AuditAction;
  /** Null when the actor is the system rather than a signed-in person. */
  actorId: string | null;
  actorRole: string | null;
  /** Whose record this concerns. Null only when the action concerns nobody. */
  patientId: string | null;
  sessionId: string | null;
  entityTable: string | null;
  entityId: string | null;
  details: AuditDetails;
}
