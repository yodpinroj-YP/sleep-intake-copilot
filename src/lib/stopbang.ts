/**
 * STOP-BANG item definitions.
 *
 * ---------------------------------------------------------------------------
 * LICENSING NOTE — READ BEFORE USING WITH REAL PATIENTS
 *
 * The STOP-BANG questionnaire is copyrighted (University Health Network,
 * Toronto). The Thai/English strings below are DELIBERATELY NOT the official
 * item wording — they are plain-language descriptions of each clinical concept,
 * written as placeholders so development can proceed before a licence is
 * granted.
 *
 * Before this is used with real patients, replace `labelTh` / `labelEn` with
 * the officially licensed wording (and the official Thai translation, if one
 * exists). Nothing else in the codebase needs to change: `key`, the scoring
 * logic, and the database rows are all independent of the wording.
 * ---------------------------------------------------------------------------
 *
 * Only the four *questionnaire* items live here (S, T, O, P). The other four
 * (B, A, N, G) are derived from data the system already holds:
 *
 *   B — BMI > 35        -> intake_sessions.bmi (generated column)
 *   A — Age > 50        -> profiles.date_of_birth
 *   N — Neck > 40 cm    -> intake_sessions.neck_circumference_cm
 *   G — Gender = male   -> profiles.sex
 *
 * Keeping the derived items out of this list is what stops the form from
 * asking a patient something the database can already answer.
 */

export const STOPBANG_DOMAIN = "stopbang";

export interface StopBangQuestion {
  /** Stable identifier — written to intake_responses.question_key. Never translate this. */
  key: string;
  /** Which STOP-BANG letter this item is, for the clinician-facing breakdown. */
  letter: "S" | "T" | "O" | "P";
  labelTh: string;
  labelEn: string;
  /** Short clarification shown under the question. */
  hintTh?: string;
}

export const STOPBANG_QUESTIONS: StopBangQuestion[] = [
  {
    key: "stopbang_snoring",
    letter: "S",
    labelTh: "คุณนอนกรนเสียงดังหรือไม่",
    labelEn: "Snoring",
    hintTh: "ดังจนคนที่นอนห้องเดียวกันได้ยิน หรือมีคนเคยบ่นเรื่องเสียงกรนของคุณ",
  },
  {
    key: "stopbang_tired",
    letter: "T",
    labelTh: "คุณรู้สึกเหนื่อย ล้า หรือง่วงในเวลากลางวันบ่อยหรือไม่",
    labelEn: "Tired",
    hintTh: "ถึงแม้จะนอนครบชั่วโมงแล้วก็ยังรู้สึกไม่สดชื่น",
  },
  {
    key: "stopbang_observed_apnea",
    letter: "O",
    labelTh: "เคยมีคนสังเกตเห็นว่าคุณหยุดหายใจขณะหลับหรือไม่",
    labelEn: "Observed apnea",
    hintTh: "เช่น คู่สมรส ญาติ หรือคนที่นอนห้องเดียวกันเคยบอก",
  },
  {
    key: "stopbang_pressure",
    letter: "P",
    labelTh: "คุณมีภาวะความดันโลหิตสูง หรือกำลังรักษาความดันอยู่หรือไม่",
    labelEn: "High blood pressure",
    hintTh: "รวมถึงกรณีที่กินยาลดความดันอยู่เป็นประจำ",
  },
];

/** Every question key this instrument writes — used when loading saved answers back. */
export const STOPBANG_QUESTION_KEYS = STOPBANG_QUESTIONS.map((q) => q.key);
