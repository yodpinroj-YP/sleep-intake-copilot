import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSENT_ITEMS,
  CONSENT_PURPOSES,
  CONSENT_TEXT_VERSION,
  isConsentPurpose,
  requiredConsentPurposes,
} from "./consent.ts";

/**
 * These tests guard the properties that make a consent record mean anything.
 *
 * Nothing here checks the prose — wording is reviewed by people, and it should
 * be. What can be checked mechanically is that the structure cannot drift into
 * a state where the database stores a consent nobody can interpret.
 */

describe("consent purposes", () => {
  it("matches the check constraint in 0010_consents.sql", () => {
    // The database is what actually refuses an unknown purpose. This test
    // exists so a disagreement between the two fails in CI instead of as a
    // constraint violation in front of a patient.
    assert.deepEqual([...CONSENT_PURPOSES].sort(), [
      "ai_summary",
      "care",
      "research",
    ]);
  });

  it("describes every purpose exactly once", () => {
    const described = CONSENT_ITEMS.map((i) => i.purpose);
    assert.deepEqual([...described].sort(), [...CONSENT_PURPOSES].sort());
    assert.equal(new Set(described).size, described.length);
  });

  it("recognises only the purposes it knows", () => {
    assert.equal(isConsentPurpose("care"), true);
    assert.equal(isConsentPurpose("marketing"), false);
    assert.equal(isConsentPurpose(null), false);
    assert.equal(isConsentPurpose(42), false);
  });
});

describe("what the patient is shown", () => {
  it("gives every purpose text in both languages", () => {
    // A missing Thai string would render as an empty box the patient is asked
    // to agree to, which is worse than an error.
    for (const item of CONSENT_ITEMS) {
      assert.ok(item.titleTh.length > 0, `${item.purpose} has no Thai title`);
      assert.ok(item.titleEn.length > 0, `${item.purpose} has no English title`);
      assert.ok(item.bodyTh.length > 0, `${item.purpose} has no Thai body`);
      assert.ok(item.bodyEn.length > 0, `${item.purpose} has no English body`);
    }
  });

  it("tells the patient what declining costs them, for every optional item", () => {
    // Consent is only meaningful if refusing is a real option, and refusing is
    // only a real option if the consequence is stated. The required item is
    // exempt: there is no service without it, which the interface says
    // separately.
    for (const item of CONSENT_ITEMS.filter((i) => !i.required)) {
      assert.ok(
        item.ifDeclinedTh.length > 0,
        `${item.purpose} does not say what happens if the patient declines`
      );
      assert.ok(item.ifDeclinedEn.length > 0);
    }
  });

  it("treats exactly one purpose as required", () => {
    // If a second purpose ever became required, a patient could no longer use
    // the system without also agreeing to AI or to research — which would make
    // that consent something other than freely given. Failing here is a prompt
    // to think, not a rule to edit away.
    assert.deepEqual(requiredConsentPurposes(), ["care"]);
  });
});

describe("version stamp", () => {
  it("is a non-empty string that goes into every stored row", () => {
    assert.equal(typeof CONSENT_TEXT_VERSION, "string");
    assert.ok(CONSENT_TEXT_VERSION.length > 0);
  });
});
