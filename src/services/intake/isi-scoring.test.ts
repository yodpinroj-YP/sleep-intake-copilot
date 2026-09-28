import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoriseInsomnia,
  ISI_FIELDS,
  ISI_FLAG_TYPES,
  ISI_MAX_ITEM_SCORE,
  ISI_MAX_TOTAL_SCORE,
  MODERATE_INSOMNIA_CUTOFF,
  parseItemScore,
  scoreIsi,
  SEVERE_INSOMNIA_CUTOFF,
  SUBTHRESHOLD_INSOMNIA_CUTOFF,
  type IsiInput,
  type IsiItemScore,
} from "./isi-scoring.ts";

/**
 * Tests for the Insomnia Severity Index scoring rules.
 *
 * Run with:  npm test
 *
 * Same reasoning as the other two instruments: a wrong score here is a
 * clinical error, not a cosmetic bug. The cases that matter most are the ones
 * where the total looks reassuring and the underlying data does not support
 * that reading — an unfinished questionnaire, or an off-by-one at a band edge.
 */

/** Builds an input where every item carries the same answer. */
function uniform(value: IsiItemScore | null): IsiInput {
  return Object.fromEntries(
    ISI_FIELDS.map((field) => [field, value])
  ) as unknown as IsiInput;
}

/** Builds an input from seven answers in questionnaire order. */
function fromAnswers(answers: (IsiItemScore | null)[]): IsiInput {
  assert.equal(answers.length, ISI_FIELDS.length, "expected seven answers");
  return Object.fromEntries(
    ISI_FIELDS.map((field, index) => [field, answers[index]])
  ) as unknown as IsiInput;
}

describe("ISI totals", () => {
  it("scores an untouched questionnaire as 0 and reports it as incomplete", () => {
    const result = scoreIsi(uniform(null));
    assert.equal(result.score, 0);
    assert.equal(result.answeredCount, 0);
    assert.equal(result.incomplete, true);
    // The distinction the whole design rests on: 0 answered is not a 0 score.
    assert.equal(result.maxPossibleScore, ISI_MAX_TOTAL_SCORE);
    // `scoreAndSaveIsiSession` reads exactly this field to decide whether to
    // write a `questionnaire_scores` row at all. If answeredCount ever stopped
    // being 0 here, a patient who reported insomnia symptoms and answered
    // nothing would be stored as "ISI 0 / 28, no insomnia" — so this assertion
    // is load-bearing outside this file, not a restatement of the one above.
  });

  it("scores all-zero answers as a complete questionnaire", () => {
    const result = scoreIsi(uniform(0));
    assert.equal(result.score, 0);
    assert.equal(result.answeredCount, 7);
    assert.equal(result.incomplete, false);
    assert.equal(result.maxPossibleScore, 0);
    assert.equal(result.severity, "none");
  });

  it("reaches the documented maximum of 28", () => {
    const result = scoreIsi(uniform(4));
    assert.equal(result.score, ISI_MAX_TOTAL_SCORE);
    assert.equal(result.score, 28);
    assert.equal(result.severity, "severe");
  });

  it("sums a mixed set correctly", () => {
    const result = scoreIsi(fromAnswers([3, 2, 1, 4, 0, 2, 3]));
    assert.equal(result.score, 15);
    assert.equal(result.answeredCount, 7);
    assert.equal(result.incomplete, false);
  });
});

describe("ISI severity bands", () => {
  it("places the published cut-offs exactly", () => {
    assert.equal(categoriseInsomnia(0), "none");
    assert.equal(categoriseInsomnia(7), "none");
    assert.equal(categoriseInsomnia(SUBTHRESHOLD_INSOMNIA_CUTOFF), "subthreshold");
    assert.equal(categoriseInsomnia(14), "subthreshold");
    assert.equal(categoriseInsomnia(MODERATE_INSOMNIA_CUTOFF), "moderate");
    assert.equal(categoriseInsomnia(21), "moderate");
    assert.equal(categoriseInsomnia(SEVERE_INSOMNIA_CUTOFF), "severe");
    assert.equal(categoriseInsomnia(28), "severe");
  });

  it("does not shift a band by one point", () => {
    // 7/8 and 14/15 and 21/22 are the three edges a transcription error moves.
    assert.notEqual(categoriseInsomnia(7), categoriseInsomnia(8));
    assert.notEqual(categoriseInsomnia(14), categoriseInsomnia(15));
    assert.notEqual(categoriseInsomnia(21), categoriseInsomnia(22));
  });
});

describe("ISI incomplete questionnaires", () => {
  it("reports a partial total as a floor with a reachable ceiling", () => {
    // Four answered, three missing: 11 now, up to 23 once finished.
    const result = scoreIsi(fromAnswers([4, 4, 3, null, null, null, 0]));
    assert.equal(result.score, 11);
    assert.equal(result.answeredCount, 4);
    assert.equal(result.incomplete, true);
    assert.equal(result.maxPossibleScore, 11 + 3 * ISI_MAX_ITEM_SCORE);
    assert.equal(result.maxPossibleScore, 23);
  });

  it("can sit in a reassuring band while its ceiling is severe", () => {
    // This is the case the clinician UI must never present as settled.
    const result = scoreIsi(fromAnswers([4, 3, null, null, null, null, 0]));
    assert.equal(result.severity, "none", "the floor reads as no insomnia");
    assert.equal(categoriseInsomnia(result.maxPossibleScore), "severe");
    assert.equal(result.incomplete, true);
  });

  it("counts a single missing item", () => {
    const result = scoreIsi(fromAnswers([2, 2, 2, 2, 2, 2, null]));
    assert.equal(result.score, 12);
    assert.equal(result.answeredCount, 6);
    assert.equal(result.incomplete, true);
    assert.equal(result.maxPossibleScore, 16);
  });
});

describe("ISI answer parsing", () => {
  it("accepts every valid item score", () => {
    for (const value of [0, 1, 2, 3, 4]) {
      assert.equal(parseItemScore(value), value);
    }
  });

  it("rejects anything outside 0–4 as unanswered rather than coercing it", () => {
    for (const value of [5, -1, 1.5, "3", true, null, undefined, {}, []]) {
      assert.equal(parseItemScore(value), null, `should reject ${String(value)}`);
    }
  });

  it("does not accept a valid ESS answer as automatically valid here", () => {
    // 4 is out of range on ESS and in range here. The two parsers are separate
    // precisely so that this asymmetry cannot be lost in a shared helper.
    assert.equal(parseItemScore(4), 4);
  });

  it("treats an out-of-range stored answer as missing, not as zero", () => {
    const result = scoreIsi(fromAnswers([4, 4, 4, 9 as unknown as IsiItemScore, 4, 4, 4]));
    assert.equal(result.score, 24);
    assert.equal(result.answeredCount, 6);
    assert.equal(result.incomplete, true, "a bad value must surface as a gap");
  });
});

describe("ISI breakdown", () => {
  it("returns all seven items in questionnaire order with positions", () => {
    const result = scoreIsi(uniform(1));
    assert.equal(result.breakdown.length, 7);
    result.breakdown.forEach((item, index) => {
      assert.equal(item.position, index + 1);
      assert.equal(item.field, ISI_FIELDS[index]);
      assert.equal(item.answered, true);
      assert.ok(item.label.length > 0);
    });
  });

  it("marks only the unanswered items as unanswered", () => {
    const result = scoreIsi(fromAnswers([1, null, 1, null, 1, 1, 1]));
    const unanswered = result.breakdown.filter((item) => !item.answered);
    assert.deepEqual(
      unanswered.map((item) => item.field),
      ["stayingAsleep", "sleepDissatisfaction"]
    );
  });
});

describe("ISI safety flags", () => {
  it("owns no flag types", () => {
    // Not an oversight. See the comment on ISI_FLAG_TYPES: severe insomnia is
    // a reason to treat, not a reason to contact the patient before their
    // appointment, and a flag column that fills with routine cases stops being
    // read at all — including the drowsy-driving flag sitting next to it.
    assert.equal(ISI_FLAG_TYPES.length, 0);
  });
});
