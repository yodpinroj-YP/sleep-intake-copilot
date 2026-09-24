import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertNoIdentifiers,
  buildSummaryInput,
  IdentifierLeakError,
  toAgeBand,
  type SummarySource,
} from "./summary-input.ts";

/**
 * Tests for the de-identified model input.
 *
 * Run with:  npm test
 *
 * These are not ordinary unit tests. They are the evidence that this system
 * does not send patient identifiers to a third party — the thing a hospital IT
 * department will ask about, and the thing that cannot be demonstrated after
 * the fact. If one of them fails, nothing should be deployed until it passes.
 */

const SOURCE: SummarySource = {
  ageYears: 58,
  sex: "male",
  bmi: 36.24,
  neckCircumferenceCm: 43.15,
  stopBang: {
    score: 6,
    maxPossibleScore: 6,
    incomplete: false,
    answeredCount: 8,
    riskCategory: "high",
    items: [
      { letter: "S", label: "Snoring", scored: true, answered: true },
      { letter: "T", label: "Tired", scored: true, answered: true },
    ],
  },
  ess: {
    score: 17,
    maxPossibleScore: 17,
    incomplete: false,
    answeredCount: 8,
    severity: "severe",
    items: [
      { position: 1, label: "Sitting and reading", score: 3, answered: true },
      { position: 8, label: "Stopped in traffic", score: 2, answered: true },
    ],
  },
  flags: [
    {
      type: "high_osa_risk",
      severity: "standard",
      reason: "STOP-BANG score 6/8 (cut-off 5)",
    },
  ],
};

describe("age banding", () => {
  it("reports a decade band rather than the age itself", () => {
    const input = buildSummaryInput(SOURCE);
    assert.equal(input.ageBand, "50_59");

    // The exact age must not survive anywhere in the payload.
    assert.equal(JSON.stringify(input).includes("58"), false);
  });

  it("places each decade in the right band", () => {
    assert.equal(toAgeBand(29), "under_30");
    assert.equal(toAgeBand(30), "30_39");
    assert.equal(toAgeBand(49), "40_49");
    assert.equal(toAgeBand(50), "50_59");
    assert.equal(toAgeBand(69), "60_69");
    assert.equal(toAgeBand(70), "70_79");
    assert.equal(toAgeBand(80), "80_plus");
    assert.equal(toAgeBand(101), "80_plus");
  });

  it("returns null for a missing or impossible age instead of guessing", () => {
    assert.equal(toAgeBand(null), null);
    assert.equal(toAgeBand(-1), null);
    assert.equal(toAgeBand(Number.NaN), null);
  });
});

describe("payload contents", () => {
  it("carries exactly the allowed fields and no others", () => {
    const input = buildSummaryInput(SOURCE);

    assert.deepEqual(Object.keys(input).sort(), [
      "ageBand",
      "bmi",
      "ess",
      "flags",
      "neckCircumferenceCm",
      "sex",
      "stopBang",
    ]);
  });

  it("rounds measurements to one decimal place", () => {
    const input = buildSummaryInput(SOURCE);
    assert.equal(input.bmi, 36.2);
    assert.equal(input.neckCircumferenceCm, 43.2);
  });

  it("keeps the clinical content the summary actually needs", () => {
    const input = buildSummaryInput(SOURCE);
    assert.equal(input.stopBang?.score, 6);
    assert.equal(input.ess?.score, 17);
    assert.equal(input.ess?.severity, "severe");
    assert.equal(input.flags.length, 1);
  });

  it("ignores extra fields a caller passes by mistake", () => {
    // Simulates someone widening the source object without updating the
    // allowlist — the new field must not reach the model.
    const contaminated = {
      ...SOURCE,
      fullName: "สมหญิง วัฒนกุล",
      hospitalNumber: "HN-0099123",
    } as SummarySource;

    const input = buildSummaryInput(contaminated);
    const serialised = JSON.stringify(input);

    assert.equal(serialised.includes("สมหญิง"), false);
    assert.equal(serialised.includes("HN-0099123"), false);
  });
});

describe("identifier guard", () => {
  it("passes a clean payload", () => {
    const input = buildSummaryInput(SOURCE);

    assert.doesNotThrow(() =>
      assertNoIdentifiers(input, {
        fullName: "สมหญิง วัฒนกุล",
        hospitalNumber: "HN-0099123",
        dateOfBirth: "1968-04-11",
        email: "somying@example.com",
        phone: "0812345678",
      })
    );
  });

  it("throws when a name reaches the payload", () => {
    assert.throws(
      () =>
        assertNoIdentifiers(
          { note: "ผู้ป่วยชื่อ สมหญิง วัฒนกุล มีอาการกรน" },
          { fullName: "สมหญิง วัฒนกุล" }
        ),
      IdentifierLeakError
    );
  });

  it("throws when a hospital number reaches the payload", () => {
    assert.throws(
      () => assertNoIdentifiers({ ref: "HN-0099123" }, { hospitalNumber: "HN-0099123" }),
      IdentifierLeakError
    );
  });

  it("catches an identifier regardless of letter case", () => {
    assert.throws(
      () => assertNoIdentifiers({ email: "SOMYING@EXAMPLE.COM" }, { email: "somying@example.com" }),
      IdentifierLeakError
    );
  });

  it("names the offending field, so the failure is actionable", () => {
    try {
      assertNoIdentifiers({ dob: "1968-04-11" }, { dateOfBirth: "1968-04-11" });
      assert.fail("expected the guard to throw");
    } catch (err) {
      assert.ok(err instanceof IdentifierLeakError);
      assert.match(err.message, /dateOfBirth/);
    }
  });

  it("skips identifiers too short to match meaningfully", () => {
    // A two-character value would match by coincidence and make every payload
    // fail, which would train people to disable the guard.
    assert.doesNotThrow(() => assertNoIdentifiers({ sex: "male" }, { fullName: "ma" }));
  });

  it("ignores identifiers that are missing or blank", () => {
    assert.doesNotThrow(() =>
      assertNoIdentifiers(buildSummaryInput(SOURCE), {
        fullName: null,
        hospitalNumber: "",
        dateOfBirth: undefined,
      })
    );
  });
});
