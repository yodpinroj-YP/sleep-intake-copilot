import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONSENT_PURPOSES,
  CONSENT_TEXT_VERSION,
  requiredConsentPurposes,
} from "@/lib/consent";
import type { ConsentPurpose } from "@/lib/consent";
import { recordAuditEvents } from "@/services/audit/audit-log";
import type { Database } from "@/types/database.types";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Reading and recording consent.
 *
 * Everything here runs through the caller's own RLS-bound client, not the
 * service role. That is deliberate and it is the whole security model for this
 * table: a patient can only read and write their own consent because the
 * database says so, not because this file remembers to filter.
 */

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  /** The wording version the patient agreed to, or null if never asked. */
  textVersion: string | null;
  recordedAt: string | null;
  /**
   * True when consent was given, but against an older version of the wording.
   *
   * Treated as "must ask again" rather than "still consented", because the
   * patient agreed to text that no longer describes what happens.
   */
  stale: boolean;
}

export type ConsentMap = Record<ConsentPurpose, ConsentState>;

function emptyState(purpose: ConsentPurpose): ConsentState {
  return { purpose, granted: false, textVersion: null, recordedAt: null, stale: false };
}

/**
 * The current position on every purpose, including the ones never answered.
 *
 * Returns a complete map rather than the rows that happen to exist, so callers
 * cannot accidentally treat "never asked" as "declined" — those are different
 * facts, and only one of them means the patient has been given a choice.
 */
export async function readConsents(
  supabase: TypedSupabaseClient,
  patientId: string
): Promise<ConsentMap> {
  const { data, error } = await supabase
    .from("current_consents")
    .select("purpose, granted, text_version, recorded_at")
    .eq("patient_id", patientId);

  if (error) {
    throw new Error(`Failed to read consents: ${error.message}`);
  }

  const map = Object.fromEntries(
    CONSENT_PURPOSES.map((p) => [p, emptyState(p)])
  ) as ConsentMap;

  for (const row of data ?? []) {
    const purpose = row.purpose as ConsentPurpose;
    if (!(purpose in map)) continue;

    map[purpose] = {
      purpose,
      granted: row.granted,
      textVersion: row.text_version,
      recordedAt: row.recorded_at,
      stale: row.granted && row.text_version !== CONSENT_TEXT_VERSION,
    };
  }

  return map;
}

/**
 * True when every required consent is in force at the current wording version.
 *
 * This is the gate the application checks before collecting anything.
 */
export function hasRequiredConsent(consents: ConsentMap): boolean {
  return requiredConsentPurposes().every(
    (p) => consents[p].granted && !consents[p].stale
  );
}

/** True when the patient may be sent to an AI provider at all. */
export function hasAiConsent(consents: ConsentMap): boolean {
  return consents.ai_summary.granted && !consents.ai_summary.stale;
}

export class ConsentWriteFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentWriteFailedError";
  }
}

/**
 * Records one decision as a new row, and logs it.
 *
 * Never an update. Withdrawing consent and granting it again are two more
 * rows, and the history between them is the record.
 *
 * The audit write is not swallowed. A consent change that happened without
 * being logged is exactly the situation the log exists to prevent, so the
 * caller is made to deal with the failure rather than reporting success.
 */
export async function recordConsent(
  supabase: TypedSupabaseClient,
  patientId: string,
  purpose: ConsentPurpose,
  granted: boolean
): Promise<void> {
  const { error } = await supabase.from("consents").insert({
    patient_id: patientId,
    purpose,
    granted,
    text_version: CONSENT_TEXT_VERSION,
    recorded_by: patientId,
    source: "patient_web",
  });

  if (error) {
    throw new ConsentWriteFailedError(
      `บันทึกความยินยอมไม่สำเร็จ: ${error.message}`
    );
  }

  await recordAuditEvents([
    {
      action: granted ? "consent_granted" : "consent_withdrawn",
      actorId: patientId,
      actorRole: "patient",
      patientId,
      sessionId: null,
      entityTable: "consents",
      entityId: null,
      details: {
        consentPurpose: purpose,
        consentTextVersion: CONSENT_TEXT_VERSION,
      },
    },
  ]);
}

/**
 * Refuses to go on unless the required consent is in force.
 *
 * Called from the places that collect or process health data, so the check
 * sits next to the thing it protects rather than in a page that a later route
 * might forget to imitate.
 */
export async function assertRequiredConsent(
  supabase: TypedSupabaseClient,
  patientId: string
): Promise<void> {
  const consents = await readConsents(supabase, patientId);

  if (!hasRequiredConsent(consents)) {
    throw new Error(
      "ยังไม่ได้ให้ความยินยอมในการเก็บและใช้ข้อมูลสุขภาพ กรุณาอ่านและยืนยันความยินยอมก่อนเริ่มทำแบบประเมิน"
    );
  }
}
