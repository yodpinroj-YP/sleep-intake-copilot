import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoriseSleepiness,
  detectEssSafetyFlags,
  DROWSY_DRIVING_FLAG,
  ESS_FIELDS,
  ESS_MAX_TOTAL_SCORE,
  parseItemScore,
  scoreEss,
  SEVERE_SLEEPINESS_FLAG,
  type EssInput,
  type EssItemScore,
} from "./ess-scoring.ts";

/**
 * Tests for the Epworth Sleepiness Scale scoring rules.
 *
 * Run with:  npm test
 *
 * Same reasoning as the STOP-BANG tests: a wrong score is a clinical error,
 * not a cosmetic bug. The cases that matter most here are the ones where the
 * total looks reassuring but the individual answers are not.
 */

/** Builds an input where every item carries the same answer. */
function uniform(value: EssItemScore | null): EssInput {
  return Object.fromEntries(
    ESS_FIELDS.map((field) => [field, value])
  ) as unknown as EssInput;
}

/** Builds an input from the eight item scores in questionnaire order. */
function fromScores(scores: (EssItemScore | null)[]): EssInput {
  assert.equal(
    scores.length,
    ESS_FIELDS.length,
    "test helper was given the wrong number of items"
  );
  return Object.fromEntries(
    ESS_FIELDS.map((field, index) => [field, scores[index]])
  ) as unknown as EssInput;
}

describe("ESS total score", () => {
  it("scores zero when every item is 0", () => {
    const result = scoreEss(uniform(0));
    assert.equal(result.score, 0);
    assert.equal(result.answeredCount, 8);
    assert.equal(result.incomplete, false);
  });

  it("scores the maximum when every item is 3", () => {
    const result = scoreEss(uniform(3));
    assert.equal(result.score, ESS_MAX_TOTAL_SCORE);
    assert.equal(result.score, 24);
  });

  it("sums mixed answers", () => {
    const result = scoreEss(fromScores([0, 1, 2, 3, 0, 1, 2, 3]));
    assert.equal(result.score, 12);
    assert.equal(result.answeredCount, 8);
  });

  it("reports one breakdown entry per item, in questionnaire order", () => {
    const result = scoreEss(fromScores([3, 0, 0, 0, 0, 0, 0, 0]));
    assert.equal(result.breakdown.length, 8);
    assert.deepEqual(
      result.breakdown.map((item) => item.position),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert.equal(result.breakdown[0].field, "sittingReading");
    assert.equal(result.breakdown[7].field, "inCarTraffic");
  });
});

describe("severity bands", () => {
  it("treats 10 as normal and 11 as mild", () => {
    // The clinically conventional boundary is "above 10", so 10 must NOT be
    // excessive sleepiness and 11 must be.
    assert.equal(categoriseSleepiness(10), "normal");
    assert.equal(categoriseSleepiness(11), "mild");
  });

  it("treats 12 as mild and 13 as moderate", () => {
    assert.equal(categoriseSleepiness(12), "mild");
    assert.equal(categoriseSleepiness(13), "moderate");
  });

  it("treats 15 as moderate and 16 as severe", () => {
    assert.equal(categoriseSleepiness(15), "moderate");
    assert.equal(categoriseSleepiness(16), "severe");
  });

  it("treats the maximum as severe", () => {
    assert.equal(categoriseSleepiness(24), "severe");
  });

  it("treats zero as normal", () => {
    assert.equal(categoriseSleepiness(0), "normal");
  });
});

describe("missing answers", () => {
  it("distinguishes an unanswered item from an answer of 0", () => {
    const zeros = scoreEss(uniform(0));
    const blanks = scoreEss(uniform(null));

    // Both total zero, but only one of them is a finished questionnaire.
    assert.equal(zeros.score, 0);
    assert.equal(blanks.score, 0);
    assert.equal(zeros.incomplete, false);
    assert.equal(blanks.incomplete, true);
    assert.equal(blanks.answeredCount, 0);
  });

  it("reports the total as a floor, with the ceiling the patient could reach", () => {
    // Five items answered 3 (=15), three unanswered. The visible total of 15
    // reads as "moderate", but the patient could still land on 24.
    const result = scoreEss(fromScores([3, 3, 3, 3, 3, null, null, null]));
    assert.equal(result.score, 15);
    assert.equal(result.severity, "moderate");
    assert.equal(result.incomplete, true);
    assert.equal(result.answeredCount, 5);
    assert.equal(result.maxPossibleScore, 24);
  });

  it("makes maxPossibleScore equal the score when nothing is missing", () => {
    const result = scoreEss(fromScores([1, 1, 1, 1, 1, 1, 1, 1]));
    assert.equal(result.score, 8);
    assert.equal(result.maxPossibleScore, 8);
    assert.equal(result.incomplete, false);
  });
});

describe("parseItemScore", () => {
  it("accepts the four valid scores", () => {
    assert.equal(parseItemScore(0), 0);
    assert.equal(parseItemScore(1), 1);
    assert.equal(parseItemScore(2), 2);
    assert.equal(parseItemScore(3), 3);
  });

  it("rejects out-of-range and non-integer values rather than coercing them", () => {
    // 4 must not become 3, and 2.5 must not become 2 — a questionnaire that
    // quietly repairs bad input produces a score nobody can audit.
    assert.equal(parseItemScore(4), null);
    assert.equal(parseItemScore(-1), null);
    assert.equal(parseItemScore(2.5), null);
  });

  it("rejects values of the wrong type, including numeric strings", () => {
    assert.equal(parseItemScore("2"), null);
    assert.equal(parseItemScore(true), null);
    assert.equal(parseItemScore(null), null);
    assert.equal(parseItemScore(undefined), null);
    assert.equal(parseItemScore({}), null);
  });

  it("ignores an invalid stored answer when scoring, without failing", () => {
    const input = uniform(0);
    // Simulates a corrupted or hand-edited row in intake_responses.
    (input as unknown as Record<string, unknown>).watchingTv = "3";

    const result = scoreEss(input);
    assert.equal(result.score, 0);
    assert.equal(result.breakdown[1].answered, false);
    assert.equal(result.incomplete, true);
  });
});

describe("severe sleepiness flag", () => {
  it("does not fire at 15", () => {
    const result = scoreEss(fromScores([3, 3, 3, 3, 3, 0, 0, 0]));
    assert.equal(result.score, 15);
    assert.equal(
      detectEssSafetyFlags(result).some(
        (f) => f.flagType === SEVERE_SLEEPINESS_FLAG
      ),
      false
    );
  });

  it("fires at 16", () => {
    const result = scoreEss(fromScores([3, 3, 3, 3, 2, 2, 0, 0]));
    assert.equal(result.score, 16);

    const flag = detectEssSafetyFlags(result).find(
      (f) => f.flagType === SEVERE_SLEEPINESS_FLAG
    );
    assert.ok(flag);
    assert.equal(flag.severity, "standard");
    assert.match(flag.triggerSource, /ESS score 16\/24/);
  });

  it("does not fire on excessive sleepiness alone", () => {
    // 11 is above the clinical EDS threshold but deliberately not flagged:
    // flagging every sleepy patient would bury the flags that need action.
    const result = scoreEss(fromScores([2, 2, 2, 2, 1, 1, 1, 0]));
    assert.equal(result.score, 11);
    assert.equal(result.severity, "mild");
    assert.equal(detectEssSafetyFlags(result).length, 0);
  });

  it("does not fire on a floor that has not actually reached the cut-off", () => {
    // 14 answered, two items missing — could reach 20, but is not flagged yet.
    const result = scoreEss(fromScores([3, 3, 3, 3, 2, 0, null, null]));
    assert.equal(result.score, 14);
    assert.equal(result.incomplete, true);
    assert.equal(result.maxPossibleScore, 20);
    assert.equal(detectEssSafetyFlags(result).length, 0);
  });
});

describe("drowsy driving flag", () => {
  it("fires on a maximum answer to the traffic item even when the total is normal", () => {
    // This is the case the rule exists for: total 9 is comfortably "normal",
    // but the patient reports a high chance of dozing at the wheel.
    const result = scoreEss(fromScores([1, 1, 1, 1, 1, 1, 0, 3]));
    assert.equal(result.score, 9);
    assert.equal(result.severity, "normal");

    const flag = detectEssSafetyFlags(result).find(
      (f) => f.flagType === DROWSY_DRIVING_FLAG
    );
    assert.ok(flag);
    assert.equal(flag.severity, "urgent");
    assert.match(flag.triggerSource, /item 8/);
  });

  it("does not fire on a moderate answer to the traffic item", () => {
    const result = scoreEss(fromScores([1, 1, 1, 1, 1, 1, 0, 2]));
    assert.equal(
      detectEssSafetyFlags(result).some(
        (f) => f.flagType === DROWSY_DRIVING_FLAG
      ),
      false
    );
  });

  it("does not fire when the traffic item is unanswered", () => {
    const result = scoreEss(fromScores([3, 3, 3, 3, 3, 3, 3, null]));
    assert.equal(
      detectEssSafetyFlags(result).some(
        (f) => f.flagType === DROWSY_DRIVING_FLAG
      ),
      false
    );
  });

  it("is independent of the severe-sleepiness flag — both can fire together", () => {
    const result = scoreEss(uniform(3));
    const types = detectEssSafetyFlags(result).map((f) => f.flagType);
    assert.equal(types.length, 2);
    assert.ok(types.includes(SEVERE_SLEEPINESS_FLAG));
    assert.ok(types.includes(DROWSY_DRIVING_FLAG));
  });

  it("raises nothing for a patient who scores zero", () => {
    assert.deepEqual(detectEssSafetyFlags(scoreEss(uniform(0))), []);
  });
});
