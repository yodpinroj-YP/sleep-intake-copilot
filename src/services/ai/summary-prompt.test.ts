import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUserPrompt,
  parseSummaryDraft,
  PROMPT_VERSION,
  SummaryParseError,
  SYSTEM_PROMPT,
} from "./summary-prompt.ts";

/**
 * Tests for the summary prompt and its parser.
 *
 * Run with:  npm test
 *
 * The parser tests matter most. A language model's reply is untrusted input —
 * it can be truncated, wrapped in markdown, or simply wrong — and anything
 * that survives this function gets written into a clinician's review queue.
 */

const VALID = JSON.stringify({
  summary_text: "ผู้ป่วยชายวัย 50-59 ปี มีคะแนนคัดกรองอยู่ในเกณฑ์เสี่ยงสูง",
  key_symptoms: ["นอนกรนเสียงดัง", "มีผู้สังเกตเห็นการหยุดหายใจ"],
  important_negatives: ["ไม่มีประวัติความดันโลหิตสูง"],
  missing_information: ["ยังไม่ได้วัดรอบคอ"],
  needs_verification: ["ยืนยันความเสี่ยงขณะขับรถกับผู้ป่วยโดยตรง"],
});

describe("prompt construction", () => {
  it("names a version, so a stored summary can be traced to its instructions", () => {
    assert.equal(typeof PROMPT_VERSION, "string");
    assert.ok(PROMPT_VERSION.length > 0);
  });

  it("forbids invention, diagnosis and invented identifiers", () => {
    // These are the three rules that keep the model on the right side of the
    // line. If someone rewrites the prompt and drops one, this fails.
    assert.match(SYSTEM_PROMPT, /ห้ามเพิ่มอาการ/);
    assert.match(SYSTEM_PROMPT, /ห้ามวินิจฉัยโรค/);
    assert.match(SYSTEM_PROMPT, /ห้ามสร้างชื่อ/);
  });

  it("requires incomplete scores to be reported as a floor", () => {
    assert.match(SYSTEM_PROMPT, /ค่าต่ำสุดที่เป็นไปได้/);
  });

  it("embeds the payload as readable JSON", () => {
    const prompt = buildUserPrompt({ ageBand: "50_59", bmi: 36.2 });
    assert.match(prompt, /"ageBand": "50_59"/);
    assert.match(prompt, /"bmi": 36.2/);
  });
});

describe("parsing a well-formed reply", () => {
  it("reads every field", () => {
    const draft = parseSummaryDraft(VALID);

    assert.match(draft.summaryText, /เสี่ยงสูง/);
    assert.equal(draft.keySymptoms.length, 2);
    assert.equal(draft.importantNegatives.length, 1);
    assert.equal(draft.missingInformation.length, 1);
    assert.equal(draft.needsVerification.length, 1);
  });

  it("accepts a reply wrapped in a markdown code fence", () => {
    const draft = parseSummaryDraft("```json\n" + VALID + "\n```");
    assert.match(draft.summaryText, /เสี่ยงสูง/);
  });

  it("accepts empty lists — a patient may genuinely have none", () => {
    const draft = parseSummaryDraft(
      JSON.stringify({ summary_text: "สรุปสั้น ๆ", key_symptoms: [] })
    );

    assert.equal(draft.summaryText, "สรุปสั้น ๆ");
    assert.deepEqual(draft.keySymptoms, []);
    assert.deepEqual(draft.missingInformation, []);
  });
});

describe("refusing a bad reply", () => {
  it("refuses an empty response", () => {
    assert.throws(() => parseSummaryDraft(""), SummaryParseError);
    assert.throws(() => parseSummaryDraft("   "), SummaryParseError);
  });

  it("refuses prose that is not JSON", () => {
    assert.throws(
      () => parseSummaryDraft("ขออภัย ฉันไม่สามารถช่วยเรื่องนี้ได้"),
      SummaryParseError
    );
  });

  it("refuses truncated JSON", () => {
    assert.throws(
      () => parseSummaryDraft('{"summary_text": "ผู้ป่วยราย'),
      SummaryParseError
    );
  });

  it("refuses a JSON array", () => {
    assert.throws(() => parseSummaryDraft('["a", "b"]'), SummaryParseError);
  });

  it("refuses a reply with no summary paragraph", () => {
    // An empty body would sit in the review queue looking like real work.
    assert.throws(
      () => parseSummaryDraft(JSON.stringify({ key_symptoms: ["กรน"] })),
      SummaryParseError
    );
    assert.throws(
      () => parseSummaryDraft(JSON.stringify({ summary_text: "   " })),
      SummaryParseError
    );
  });
});

describe("hardening against a runaway reply", () => {
  it("drops non-string entries instead of storing them", () => {
    const draft = parseSummaryDraft(
      JSON.stringify({
        summary_text: "สรุป",
        key_symptoms: ["กรน", 42, null, { a: 1 }, "ง่วง"],
      })
    );

    assert.deepEqual(draft.keySymptoms, ["กรน", "ง่วง"]);
  });

  it("ignores a list sent as something other than an array", () => {
    const draft = parseSummaryDraft(
      JSON.stringify({ summary_text: "สรุป", key_symptoms: "กรน" })
    );

    assert.deepEqual(draft.keySymptoms, []);
  });

  it("caps the number of list items", () => {
    const draft = parseSummaryDraft(
      JSON.stringify({
        summary_text: "สรุป",
        key_symptoms: Array.from({ length: 100 }, (_, i) => `อาการที่ ${i}`),
      })
    );

    assert.equal(draft.keySymptoms.length, 20);
  });

  it("caps the length of the summary paragraph", () => {
    const draft = parseSummaryDraft(
      JSON.stringify({ summary_text: "ก".repeat(10_000) })
    );

    assert.equal(draft.summaryText.length, 4_000);
  });

  it("drops blank list entries", () => {
    const draft = parseSummaryDraft(
      JSON.stringify({ summary_text: "สรุป", missing_information: ["", "  ", "รอบคอ"] })
    );

    assert.deepEqual(draft.missingInformation, ["รอบคอ"]);
  });
});
