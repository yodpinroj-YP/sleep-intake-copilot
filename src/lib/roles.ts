import type { UserRole } from "@/types/database.types";

/**
 * The two questions the application asks about a role, kept in one file so
 * they cannot drift apart — and named after the two SQL helpers that ask the
 * same questions inside the database (`is_clinician()`, `is_physician()` in
 * 0007_physician_only_decisions.sql).
 *
 * Those SQL functions are what actually enforce access. Everything here is
 * about what to *render*: a button that a nurse can see but not use is a
 * worse experience than no button, and it teaches people to distrust the
 * interface. It is not, and must never become, the security boundary —
 * a check in a React tree protects nothing.
 */

/** On the care team: may read every patient's clinical data. */
export function isCareTeam(role: UserRole | null | undefined): boolean {
  return (
    role === "nurse" ||
    role === "physician" ||
    role === "clinician" || // legacy; see 0006_add_role_values.sql
    role === "admin"
  );
}

/**
 * May record a clinical decision: approving or rejecting an AI draft, and
 * acknowledging a safety flag.
 *
 * A nurse runs the intake queue, chases missing measurements and reads
 * everything. What they may not do is accept an AI-drafted summary into the
 * medical record, because that is an act of clinical responsibility rather
 * than a task in a workflow.
 */
export function isPhysician(role: UserRole | null | undefined): boolean {
  return role === "physician" || role === "admin";
}
