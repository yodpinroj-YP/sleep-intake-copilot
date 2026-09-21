import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateAgeYears,
  categoriseRisk,
  detectSafetyFlags,
  HIGH_OSA_RISK_FLAG,
  scoreStopBang,
  type StopBangInput,
} from "./stopbang-scoring.ts";

/**
 * Tests for the STOP-BANG scoring rules.
 *
 * Run with:  npm test
 *
 * These exist because a wrong score is a clinical error, not a cosmetic bug.
 * Every rule and every edge case below was a decision someone made — if a
 * sleep physician later says a threshold is wrong, the test that breaks tells
 * you exactly what behaviour you are changing.
 */

/** A patient who scores nothing: everything answered, nothing positive. */
const NOTHING_SCORED: StopBangInput = {
  snoring: false,
  tired: false,
  observedApnea: false,
  pressure: false,
  bmi: 22,
  ageYears: 30,
  neckCircumferenceCm: 35,
  sex: "female",
};

/** A patient who scores all eight. */
const EVERYTHING_SCORED: StopBangInput = {
  snoring: true,
  tired: true,
  observedApnea: true,
  pressure: true,
  bmi: 40,
  ageYears: 60,
  neckCircumferenceCm: 45,
  sex: "male",
};

describe("scoreStopBang — totals", () => {
  it("scores 0 when nothing is positive", () => {
    const result = scoreStopBang(NOTHING_SCORED);
    assert.equal(result.score, 0);
    assert.equal(result.riskCategory, "low");
    assert.equal(result.incomplete, false);
    assert.equal(result.answeredCount, 8);
  });

  it("scores 8 when everything is positive", () => {
    const result = scoreStopBang(EVERYTHING_SCORED);
    assert.equal(result.score, 8);
    assert.equal(result.riskCategory, "high");
    assert.equal(result.incomplete, false);
    assert.equal(result.maxPossibleScore, 8);
  });

  it("counts each of the four questionnaire items as exactly one point", () => {
    for (const key of ["snoring", "tired", "observedApnea", "pressure"] as const) {
      const result = scoreStopBang({ ...NOTHING_SCORED, [key]: true });
      assert.equal(result.score, 1, `${key} should score exactly 1 point`);
    }
  });
});

describe("scoreStopBang — thresholds are strictly greater-than", () => {
  it("does not score BMI exactly at the threshold", () => {
    assert.equal(scoreStopBang({ ...NOTHING_SCORED, bmi: 35 }).score, 0);
    assert.equal(scoreStopBang({ ...NOTHING_SCORED, bmi: 35.1 }).score, 1);
  });

  it("does not score age exactly at the threshold", () => {
    assert.equal(scoreStopBang({ ...NOTHING_SCORED, ageYears: 50 }).score, 0);
    assert.equal(scoreStopBang({ ...NOTHING_SCORED, ageYears: 51 }).score, 1);
  });

  it("does not score neck circumference exactly at the threshold", () => {
    assert.equal(
      scoreStopBang({ ...NOTHING_SCORED, neckCircumferenceCm: 40 }).score,
      0
    );
    assert.equal(
      scoreStopBang({ ...NOTHING_SCORED, neckCircumferenceCm: 40.5 }).score,
      1
    );
  });
});

describe("scoreStopBang — sex", () => {
  it("scores male", () => {
    assert.equal(scoreStopBang({ ...NOTHING_SCORED, sex: "male" }).score, 1);
  });

  it("does not score female or other, but counts both as answered", () => {
    for (const sex of ["female", "other"] as const) {
      const result = scoreStopBang({ ...NOTHING_SCORED, sex });
      assert.equal(result.score, 0);
      assert.equal(result.incomplete, false, `${sex} is an answer, not a gap`);
    }
  });

  it("treats a missing sex as unanswered, not as female", () => {
    const result = scoreStopBang({ ...NOTHING_SCORED, sex: null });
    assert.equal(result.score, 0);
    assert.equal(result.incomplete, true);
    assert.equal(result.answeredCount, 7);
  });
});

describe("scoreStopBang — missing data", () => {
  it("distinguishes a 'no' answer from no answer at all", () => {
    const answeredNo = scoreStopBang({ ...NOTHING_SCORED, snoring: false });
    const notAnswered = scoreStopBang({ ...NOTHING_SCORED, snoring: null });

    assert.equal(answeredNo.score, notAnswered.score, "neither scores a point");
    assert.equal(answeredNo.incomplete, false);
    assert.equal(notAnswered.incomplete, true);
  });

  it("reports the score as a floor and gives the highest still-reachable score", () => {
    // Four positives answered, two items missing entirely.
    const result = scoreStopBang({
      ...EVERYTHING_SCORED,
      neckCircumferenceCm: null,
      bmi: null,
    });

    assert.equal(result.score, 6, "only the six known-positive items count");
    assert.equal(result.maxPossibleScore, 8, "the two gaps could still score");
    assert.equal(result.incomplete, true);
    assert.equal(result.answeredCount, 6);
  });

  it("treats a non-finite measurement as missing rather than as zero", () => {
    const result = scoreStopBang({ ...NOTHING_SCORED, bmi: Number.NaN });
    assert.equal(result.incomplete, true);
    assert.equal(result.score, 0);
  });

  it("can score a completely empty submission without throwing", () => {
    const result = scoreStopBang({
      snoring: null,
      tired: null,
      observedApnea: null,
      pressure: null,
      bmi: null,
      ageYears: null,
      neckCircumferenceCm: null,
      sex: null,
    });

    assert.equal(result.score, 0);
    assert.equal(result.answeredCount, 0);
    assert.equal(result.maxPossibleScore, 8);
    assert.equal(result.riskCategory, "low");
  });
});

describe("categoriseRisk — boundaries", () => {
  it("puts 0-2 in low risk", () => {
    for (const score of [0, 1, 2]) {
      assert.equal(categoriseRisk(score), "low", `score ${score}`);
    }
  });

  it("puts 3-4 in intermediate risk", () => {
    for (const score of [3, 4]) {
      assert.equal(categoriseRisk(score), "intermediate", `score ${score}`);
    }
  });

  it("puts 5-8 in high risk", () => {
    for (const score of [5, 6, 7, 8]) {
      assert.equal(categoriseRisk(score), "high", `score ${score}`);
    }
  });
});

describe("detectSafetyFlags", () => {
  /** Builds a result at a chosen score by turning on that many positives. */
  function resultScoring(n: number) {
    const keys = [
      "snoring",
      "tired",
      "observedApnea",
      "pressure",
    ] as const;

    const input: StopBangInput = { ...NOTHING_SCORED };
    let remaining = n;

    for (const key of keys) {
      if (remaining === 0) break;
      input[key] = true;
      remaining -= 1;
    }
    // Items beyond the four questionnaire ones, in order: B, A, N, G.
    if (remaining > 0) { input.bmi = 40; remaining -= 1; }
    if (remaining > 0) { input.ageYears = 60; remaining -= 1; }
    if (remaining > 0) { input.neckCircumferenceCm = 45; remaining -= 1; }
    if (remaining > 0) { input.sex = "male"; remaining -= 1; }

    const result = scoreStopBang(input);
    assert.equal(result.score, n, `helper should produce score ${n}`);
    return result;
  }

  it("raises no flag below the high-risk cut-off", () => {
    for (const score of [0, 1, 2, 3, 4]) {
      assert.deepEqual(
        detectSafetyFlags(resultScoring(score)),
        [],
        `score ${score} should not flag`
      );
    }
  });

  it("raises the high-OSA-risk flag from 5 upwards", () => {
    for (const score of [5, 6, 7, 8]) {
      const flags = detectSafetyFlags(resultScoring(score));
      assert.equal(flags.length, 1, `score ${score} should flag`);
      assert.equal(flags[0].flagType, HIGH_OSA_RISK_FLAG);
    }
  });

  it("records why the flag fired, including the score and the cut-off", () => {
    const [flag] = detectSafetyFlags(resultScoring(6));
    assert.match(flag.triggerSource, /6\/8/);
    assert.match(flag.triggerSource, /STOP-BANG/);
  });

  it("uses 'standard', not 'urgent' — a high score needs a sleep study, not same-day contact", () => {
    const [flag] = detectSafetyFlags(resultScoring(8));
    assert.equal(flag.severity, "standard");
  });

  it("does not flag a score of 4 that is only a floor, since the score itself is what the rule reads", () => {
    // Four positives, two items unanswered: could really be 6, but the rule
    // deliberately reads the known score. The clinician view is what has to
    // surface `incomplete` so this gap is visible.
    const result = scoreStopBang({
      ...NOTHING_SCORED,
      snoring: true,
      tired: true,
      observedApnea: true,
      pressure: true,
      bmi: null,
      neckCircumferenceCm: null,
    });

    assert.equal(result.score, 4);
    assert.equal(result.incomplete, true);
    assert.equal(result.maxPossibleScore, 6);
    assert.deepEqual(detectSafetyFlags(result), []);
  });
});

describe("calculateAgeYears", () => {
  const asOf = new Date("2026-09-20T00:00:00Z");

  it("counts whole years", () => {
    assert.equal(calculateAgeYears("1990-09-20", asOf), 36);
  });

  it("does not count a birthday that has not happened yet this year", () => {
    assert.equal(calculateAgeYears("1990-09-21", asOf), 35);
    assert.equal(calculateAgeYears("1990-12-31", asOf), 35);
  });

  it("counts a birthday that happened earlier this year", () => {
    assert.equal(calculateAgeYears("1990-01-01", asOf), 36);
    assert.equal(calculateAgeYears("1990-09-19", asOf), 36);
  });

  it("returns null rather than guessing when the date is missing or invalid", () => {
    assert.equal(calculateAgeYears(null, asOf), null);
    assert.equal(calculateAgeYears("", asOf), null);
    assert.equal(calculateAgeYears("not a date", asOf), null);
  });

  it("returns null for a date in the future instead of a negative age", () => {
    assert.equal(calculateAgeYears("2030-01-01", asOf), null);
  });
});
