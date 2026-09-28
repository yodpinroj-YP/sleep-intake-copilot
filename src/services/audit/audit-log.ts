import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { assertAuditDetails } from "./audit-events.ts";
import type { AuditEvent } from "./audit-events.ts";

/**
 * The only way anything is written to `audit_log`.
 *
 * WHY THE SERVICE-ROLE CLIENT
 *
 * `audit_log` has RLS enabled and no policy at all (0009). Every request
 * carrying a user's JWT — patient, nurse, physician, admin — reads and writes
 * nothing. That is the intended access model, and it means the writer has to
 * be the service-role client, exactly as it is for `questionnaire_scores`.
 *
 * The usual warning applies with more force than usual here: service role
 * bypasses RLS, so this file is responsible for its own correctness. It is
 * only ever called from a path that has already established who the actor is.
 * It never derives permission, and it never decides whether an action is
 * allowed — by the time it runs, the action has happened.
 */

export class AuditWriteFailedError extends Error {
  constructor(action: string, cause: string) {
    super(`Failed to record audit event "${action}": ${cause}`);
    this.name = "AuditWriteFailedError";
  }
}

function toRow(event: AuditEvent) {
  // Throws if a caller tries to log something outside the allowlist. See the
  // long note in audit-events.ts: this is the line that keeps clinical content
  // out of a table nobody will ever delete from.
  assertAuditDetails(event.details);

  return {
    action: event.action,
    actor_id: event.actorId,
    actor_role: event.actorRole as never,
    patient_id: event.patientId,
    session_id: event.sessionId,
    entity_table: event.entityTable,
    entity_id: event.entityId,
    details: event.details,
  };
}

/**
 * Records events, and throws if it cannot.
 *
 * USE THIS FOR ANYTHING THAT CHANGES THE RECORD.
 *
 * A physician's decision that was applied but not logged is the precise
 * situation this table exists to prevent, so the caller is made to deal with
 * the failure rather than letting it pass.
 *
 * KNOWN LIMITATION, WRITTEN DOWN RATHER THAN HIDDEN. This is a second
 * statement, not part of the caller's transaction. If the action succeeds and
 * this write then fails, the action stands and the log is missing an entry —
 * the caller finds out, but the database is briefly inconsistent with its own
 * history. Closing that gap properly means moving each decision into a
 * database function so the change and its audit row commit together. That is
 * worth doing before this system sees real patients; it is recorded in
 * docs/audit-log.md as the next step rather than left for someone to discover.
 */
export async function recordAuditEvents(events: AuditEvent[]): Promise<void> {
  if (events.length === 0) return;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AuditWriteFailedError(
      events[0].action,
      "SUPABASE_SERVICE_ROLE_KEY is not set"
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert(events.map(toRow));

  if (error) {
    throw new AuditWriteFailedError(events[0].action, error.message);
  }
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  await recordAuditEvents([event]);
}

/**
 * Records events, and if it cannot, complains loudly and carries on.
 *
 * USE THIS ONLY FOR READS.
 *
 * The trade is deliberate and it goes one way: a clinician who cannot reach
 * the queue because the audit table is unavailable is a clinician who cannot
 * see an urgent drowsy-driving flag. Patient safety outranks the completeness
 * of the log, so a failed read-log does not block the read.
 *
 * It does not pass silently either. The failure cannot be written to the log
 * — that is what just failed — so it goes to the server console with a prefix
 * worth alerting on. An operator who sees this repeatedly is looking at a
 * period where reads were happening and not being recorded, and needs to know
 * that from somewhere.
 */
export async function tryRecordAuditEvents(events: AuditEvent[]): Promise<void> {
  try {
    await recordAuditEvents(events);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] READ NOT RECORDED — ${message}`);
  }
}
