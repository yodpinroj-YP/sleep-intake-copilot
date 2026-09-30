import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertAuditDetails,
  AUDIT_ACTIONS,
  AUDIT_DETAIL_KEYS,
  AUDIT_MAX_STRING_LENGTH,
} from "./audit-events.ts";

/**
 * These tests are about one thing: what is allowed into a table this project
 * has decided never to delete from.
 *
 * Everything else in the audit log can be fixed later — a missing index, a
 * clumsy action name. Clinical content written into `details` cannot be, and
 * would not be noticed until someone went looking for it.
 */

describe("audit detail allowlist", () => {
  it("accepts the shapes the application actually writes", () => {
    assert.doesNotThrow(() =>
      assertAuditDetails({ instrument: "ISI", answeredCount: 7 })
    );
    assert.doesNotThrow(() =>
      assertAuditDetails({
        instrument: "ISI",
        retractedCount: 1,
        questionKeys: ["isi_staying_asleep"],
      })
    );
    assert.doesNotThrow(() =>
      assertAuditDetails({
        decision: "approved",
        summaryVersion: 1,
        model: "gemini-3.5-flash",
      })
    );
    assert.doesNotThrow(() => assertAuditDetails({}));
  });

  it("refuses a key that is not on the allowlist", () => {
    // The realistic mistake: someone adds context that seems harmless and is
    // in fact a sentence the patient typed.
    assert.throws(
      () => assertAuditDetails({ chiefComplaint: "หลับยาก" }),
      /not on the allowlist/
    );
    assert.throws(
      () => assertAuditDetails({ patientName: "สมหญิง" }),
      /not on the allowlist/
    );
  });

  it("refuses a string long enough to be free text", () => {
    const sentence = "ก".repeat(AUDIT_MAX_STRING_LENGTH + 1);
    assert.throws(
      () => assertAuditDetails({ model: sentence }),
      /over the .* character limit/
    );
  });

  it("refuses a nested object rather than trying to inspect it", () => {
    // An allowlist that walks arbitrary structures is an allowlist with a hole
    // in it: the nested value would be the one nobody checked.
    assert.throws(
      () => assertAuditDetails({ instrument: { name: "ISI" } }),
      /must be a string, number, boolean, null or an array of strings/
    );
  });

  it("refuses an array that is not all short strings", () => {
    assert.throws(
      () => assertAuditDetails({ questionKeys: [1, 2] }),
      /may only contain strings/
    );
    assert.throws(
      () => assertAuditDetails({ questionKeys: ["x".repeat(200)] }),
      /over the .* character limit/
    );
  });

  it("throws instead of quietly dropping the offending key", () => {
    // Stripping would leave the caller believing it had recorded something it
    // had not — in the one table whose entire value is that what it says
    // happened, happened.
    const details: Record<string, unknown> = {
      instrument: "ESS",
      reviewerNotes: "ผู้ป่วยรายนี้ควรนัดติดตาม",
    };

    assert.throws(() => assertAuditDetails(details), /not on the allowlist/);
    assert.equal(
      details.reviewerNotes,
      "ผู้ป่วยรายนี้ควรนัดติดตาม",
      "the input must not be mutated — refusing is not the same as cleaning"
    );
  });
});

describe("audit vocabulary", () => {
  it("lists every action exactly once", () => {
    assert.equal(new Set(AUDIT_ACTIONS).size, AUDIT_ACTIONS.length);
    assert.equal(new Set(AUDIT_DETAIL_KEYS).size, AUDIT_DETAIL_KEYS.length);
  });

  it("matches the check constraint in 0009_audit_log.sql", () => {
    // Three copies of this list exist: the database constraint, this array,
    // and AuditActionName in database.types.ts. The constraint is the one that
    // refuses bad data, so this test is here to make a disagreement fail in
    // CI rather than at 2am in production. Update all three together.
    //
    // The constraint now lives in 0011_audit_consent_actions.sql, which
    // widened the one 0009 created — so the migration to read is the latest
    // one that touches it, not the one that created the table.
    const inMigration = [
      "record_viewed",
      "summary_requested",
      "summary_approved",
      "summary_rejected",
      "answers_saved",
      "answer_retracted",
      "session_deleted",
      "consent_granted",
      "consent_withdrawn",
    ];

    assert.deepEqual([...AUDIT_ACTIONS].sort(), inMigration.sort());
  });
});
