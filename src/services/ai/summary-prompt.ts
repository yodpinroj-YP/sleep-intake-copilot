/**
 * The prompt, and the parser for what comes back.
 *
 * Kept pure and import-free so it can be tested with `node --test`: the
 * instructions given to a model that writes into a patient's record deserve
 * the same treatment as the scoring rules, which means they live in one
 * reviewable place and their output is validated rather than trusted.
 *
 * PROMPT_VERSION is stored with every summary. When the wording here changes,
 * bump it — otherwise a clinician looking at an approved summary from three
 * months ago has no way to know which instructions produced it, and neither
 * do you when someone asks why an old summary reads differently.
 */

export const PROMPT_VERSION = "summary-v1";

/**
 * What the model is and is not allowed to do.
 *
 * Every rule below exists because of a specific failure this system cannot
 * afford. Rule 1 stops invention, which is the failure that makes clinicians
 * stop trusting AI output entirely and is not recoverable once it happens.
 * Rule 2 keeps the model on the correct side of the line between describing
 * findings and practising medicine. Rule 4 exists because this system's whole
 * position on incomplete data is that a gap must be visible, and a summary
 * that smooths over gaps would undo the work the scoring engine does to
 * surface them.
 */
export const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยเตรียมข้อมูลก่อนพบแพทย์ สำหรับแพทย์เฉพาะทางด้านการนอนหลับ
งานของคุณคือเรียบเรียงข้อมูลที่ได้รับให้แพทย์อ่านเข้าใจได้เร็วก่อนเริ่มตรวจ

กฎที่ห้ามฝ่าฝืน

1. ใช้เฉพาะข้อมูลที่ได้รับเท่านั้น ห้ามเพิ่มอาการ ประวัติ ตัวเลข หรือข้อสันนิษฐานใด ๆ ที่ไม่มีในข้อมูล
   หากข้อมูลไม่พอที่จะพูดถึงประเด็นใด ให้ระบุไว้ในช่อง missing_information แทนการเดา

2. ห้ามวินิจฉัยโรคและห้ามแนะนำการรักษา ให้บรรยายสิ่งที่ข้อมูลแสดงเท่านั้น
   เขียนว่า "คะแนนอยู่ในเกณฑ์เสี่ยงสูงตามเกณฑ์ของแบบคัดกรอง" ได้
   แต่ห้ามเขียนว่า "ผู้ป่วยเป็น OSA" หรือ "ควรเริ่ม CPAP"

3. ข้อมูลที่ได้รับถูกถอดตัวตนออกแล้ว ไม่มีชื่อ ไม่มีเลขประจำตัวผู้ป่วย
   ห้ามสร้างชื่อหรือรหัสสมมุติขึ้นมาเอง ให้เรียกว่า "ผู้ป่วย"

4. หากแบบประเมินใดตอบไม่ครบ ต้องระบุให้ชัดว่าคะแนนที่เห็นเป็นค่าต่ำสุดที่เป็นไปได้
   และระบุเพดานคะแนนที่อาจขึ้นถึงเมื่อตอบครบ ห้ามนำเสนอคะแนนที่ไม่ครบเสมือนว่าเป็นข้อสรุป

5. สัญญาณเตือนระดับ urgent ต้องถูกกล่าวถึงในย่อหน้าสรุป และต้องมีรายการใน needs_verification
   ที่ระบุว่าแพทย์ควรยืนยันเรื่องใดกับผู้ป่วยโดยตรง

6. เขียนเป็นภาษาไทย กระชับ ใช้ภาษาระดับที่แพทย์คุยกัน ย่อหน้าสรุปไม่เกิน 6 ประโยค

ตอบกลับเป็น JSON เท่านั้น ไม่ต้องมีข้อความอื่นนอก JSON ใช้โครงสร้างนี้

{
  "summary_text": "ย่อหน้าสรุปสำหรับแพทย์",
  "key_symptoms": ["ข้อค้นพบที่เป็นบวกและสำคัญ"],
  "important_negatives": ["สิ่งที่ตรวจแล้วไม่พบ และมีความหมายทางคลินิก"],
  "missing_information": ["ข้อมูลที่ยังขาดและควรถามเพิ่ม"],
  "needs_verification": ["ประเด็นที่แพทย์ต้องยืนยันกับผู้ป่วยก่อนเชื่อถือ"]
}`;

/**
 * Wraps the de-identified payload for the model.
 *
 * The reminder about placeholder wording matters: the item labels in the
 * payload are plain-language descriptions, not the licensed questionnaire
 * text, so a model told to quote the questionnaire verbatim would be quoting
 * something the patient never actually read.
 */
export function buildUserPrompt(input: unknown): string {
  return `ข้อมูลของผู้ป่วยรายนี้ (ถอดตัวตนแล้ว) อยู่ในรูปแบบ JSON ด้านล่าง

หมายเหตุ ข้อความกำกับแต่ละข้อเป็นคำอธิบายเชิงความหมาย ไม่ใช่ถ้อยคำทางการของแบบประเมิน
จึงไม่ต้องอ้างอิงถ้อยคำเหล่านี้แบบคำต่อคำ

${JSON.stringify(input, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Parsing the response
// ---------------------------------------------------------------------------

export interface SummaryDraft {
  summaryText: string;
  keySymptoms: string[];
  importantNegatives: string[];
  missingInformation: string[];
  needsVerification: string[];
}

export class SummaryParseError extends Error {
  constructor(reason: string) {
    super(`ไม่สามารถอ่านคำตอบจาก AI ได้: ${reason}`);
    this.name = "SummaryParseError";
  }
}

/** Longest a single stored field may be, as a guard against a runaway reply. */
const MAX_SUMMARY_CHARS = 4_000;
const MAX_ITEM_CHARS = 500;
const MAX_ITEMS = 20;

/**
 * Strips a markdown code fence if the model wrapped its JSON in one.
 *
 * Asking for "JSON only" works most of the time, and the response format is
 * pinned besides — but "most of the time" is not a basis for discarding a
 * perfectly good answer, and this is three lines.
 */
function unwrapCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/** Keeps only non-empty strings, trimmed and capped in length and count. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, MAX_ITEM_CHARS))
    .filter((item) => item.length > 0)
    .slice(0, MAX_ITEMS);
}

/**
 * Turns the model's reply into a draft, or refuses.
 *
 * Refusing is the important half. A summary row with an empty body would sit
 * in the review queue looking like work a clinician had to do, and the only
 * way to discover it was meaningless would be to open it. The lists are
 * allowed to come back empty — a patient may genuinely have no missing
 * information — but the summary paragraph is not optional.
 */
export function parseSummaryDraft(raw: string): SummaryDraft {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new SummaryParseError("คำตอบว่างเปล่า");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapCodeFence(raw));
  } catch {
    throw new SummaryParseError("รูปแบบไม่ใช่ JSON ที่อ่านได้");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SummaryParseError("โครงสร้างไม่ใช่วัตถุ JSON");
  }

  const obj = parsed as Record<string, unknown>;
  const summaryText =
    typeof obj.summary_text === "string" ? obj.summary_text.trim() : "";

  if (summaryText === "") {
    throw new SummaryParseError("ไม่มีเนื้อหาในช่อง summary_text");
  }

  return {
    summaryText: summaryText.slice(0, MAX_SUMMARY_CHARS),
    keySymptoms: readStringList(obj.key_symptoms),
    importantNegatives: readStringList(obj.important_negatives),
    missingInformation: readStringList(obj.missing_information),
    needsVerification: readStringList(obj.needs_verification),
  };
}
