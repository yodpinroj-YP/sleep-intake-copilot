/**
 * Insomnia Severity Index (ISI) item definitions.
 *
 * ---------------------------------------------------------------------------
 * LICENSING NOTE — READ BEFORE USING WITH REAL PATIENTS
 *
 * The ISI is copyrighted (© Charles M. Morin) and is distributed under licence;
 * as with the ESS, licensing is handled through the Mapi Research Trust and a
 * licence is required whether or not a fee is payable. Confirm the current
 * terms directly with the rights holder rather than relying on this comment.
 *
 * The Thai/English strings below are DELIBERATELY NOT the official item
 * wording. They are plain-language descriptions written as placeholders so
 * development can proceed before a licence is granted.
 *
 * Before this is used with real patients, replace `labelTh` / `labelEn` and the
 * option labels with the officially licensed wording and its official Thai
 * translation. Nothing else changes: `key`, the scoring logic, the cut-offs and
 * the stored rows are all independent of the wording.
 *
 * Third instrument, third copy of this note. That is the point — the constraint
 * is per-instrument, and a project that tracks it in one central place ends up
 * with a list nobody reads while the strings drift.
 * ---------------------------------------------------------------------------
 *
 * WHAT IS DIFFERENT HERE. The ESS uses one response scale for all eight items.
 * The ISI does not: items 1–3 rate the severity of a symptom, item 4 rates
 * satisfaction, and items 5–7 rate impact. Three scales, all 0–4, all pointing
 * the same direction (higher is worse) — including item 4, where "very
 * satisfied" is the 0. Getting that one backwards would invert a seventh of
 * the total, so the option sets are separate objects rather than one array
 * reused with different labels.
 *
 * The two recall windows are also real: items 1–3 ask about the last two
 * weeks, items 4–7 ask about now. The form groups them accordingly.
 */

export const ISI_DOMAIN = "isi";

export interface IsiOption {
  /** The number written to intake_responses.answer_value. Never translate. */
  value: 0 | 1 | 2 | 3 | 4;
  labelTh: string;
}

/** Which response scale an item uses. */
export type IsiOptionSetName = "severity" | "satisfaction" | "impact";

/**
 * Items 1–3: how severe the symptom has been.
 */
const SEVERITY_OPTIONS: IsiOption[] = [
  { value: 0, labelTh: "ไม่มีเลย" },
  { value: 1, labelTh: "เล็กน้อย" },
  { value: 2, labelTh: "ปานกลาง" },
  { value: 3, labelTh: "มาก" },
  { value: 4, labelTh: "รุนแรงมาก" },
];

/**
 * Item 4: satisfaction with the current sleep pattern.
 *
 * Note the direction. 0 is "very satisfied" and 4 is "very dissatisfied", so
 * this scale runs from good to bad like the other two even though the question
 * is phrased positively. The field in the scoring engine is called
 * `sleepDissatisfaction` for the same reason: the name states which end is 4.
 */
const SATISFACTION_OPTIONS: IsiOption[] = [
  { value: 0, labelTh: "พอใจมาก" },
  { value: 1, labelTh: "พอใจ" },
  { value: 2, labelTh: "เฉย ๆ" },
  { value: 3, labelTh: "ไม่พอใจ" },
  { value: 4, labelTh: "ไม่พอใจอย่างมาก" },
];

/** Items 5–7: how much the problem affects the patient's life. */
const IMPACT_OPTIONS: IsiOption[] = [
  { value: 0, labelTh: "ไม่เลย" },
  { value: 1, labelTh: "เล็กน้อย" },
  { value: 2, labelTh: "ปานกลาง" },
  { value: 3, labelTh: "มาก" },
  { value: 4, labelTh: "มากที่สุด" },
];

export const ISI_OPTION_SETS: Record<IsiOptionSetName, IsiOption[]> = {
  severity: SEVERITY_OPTIONS,
  satisfaction: SATISFACTION_OPTIONS,
  impact: IMPACT_OPTIONS,
};

/** The two recall windows the instrument uses. */
export type IsiGroup = "recent_two_weeks" | "current";

export const ISI_GROUP_HEADINGS: Record<IsiGroup, string> = {
  recent_two_weeks: "ในช่วงสองสัปดาห์ที่ผ่านมา",
  current: "ในปัจจุบัน",
};

export interface IsiQuestion {
  /** Stable identifier — written to intake_responses.question_key. Never translate. */
  key: string;
  /** Item position 1–7, used for display order and the clinician breakdown. */
  position: number;
  group: IsiGroup;
  optionSet: IsiOptionSetName;
  labelTh: string;
  labelEn: string;
  hintTh?: string;
}

export const ISI_QUESTIONS: IsiQuestion[] = [
  {
    key: "isi_falling_asleep",
    position: 1,
    group: "recent_two_weeks",
    optionSet: "severity",
    labelTh: "หลับยากในตอนเริ่มต้น",
    labelEn: "Difficulty falling asleep",
    hintTh: "ใช้เวลานานกว่าจะหลับหลังเข้านอน",
  },
  {
    key: "isi_staying_asleep",
    position: 2,
    group: "recent_two_weeks",
    optionSet: "severity",
    labelTh: "ตื่นกลางดึกแล้วหลับต่อยาก",
    labelEn: "Difficulty staying asleep",
  },
  {
    key: "isi_waking_early",
    position: 3,
    group: "recent_two_weeks",
    optionSet: "severity",
    labelTh: "ตื่นเช้ากว่าที่ต้องการแล้วไม่หลับต่อ",
    labelEn: "Problem waking up too early",
  },
  {
    key: "isi_dissatisfaction",
    position: 4,
    group: "current",
    optionSet: "satisfaction",
    labelTh: "คุณพอใจกับรูปแบบการนอนของคุณในตอนนี้แค่ไหน",
    labelEn: "Satisfaction with current sleep pattern",
  },
  {
    key: "isi_noticeable",
    position: 5,
    group: "current",
    optionSet: "impact",
    labelTh: "คนรอบข้างสังเกตเห็นว่าปัญหาการนอนกระทบคุณภาพชีวิตของคุณมากแค่ไหน",
    labelEn: "How noticeable to others the sleep problem is",
  },
  {
    key: "isi_worried",
    position: 6,
    group: "current",
    optionSet: "impact",
    labelTh: "คุณกังวลหรือทุกข์ใจกับปัญหาการนอนของคุณมากแค่ไหน",
    labelEn: "How worried or distressed about the sleep problem",
  },
  {
    key: "isi_interference",
    position: 7,
    group: "current",
    optionSet: "impact",
    labelTh: "ปัญหาการนอนรบกวนการใช้ชีวิตประจำวันของคุณมากแค่ไหน",
    labelEn: "Interference with daily functioning",
    hintTh: "เช่น ความเหนื่อยล้ากลางวัน อารมณ์ สมาธิ ความจำ หรือการทำงาน",
  },
];

/** Every question key this instrument writes — used when loading saved answers back. */
export const ISI_QUESTION_KEYS = ISI_QUESTIONS.map((q) => q.key);

// ---------------------------------------------------------------------------
// The screening question
// ---------------------------------------------------------------------------

/**
 * Asked before the seven items, and answered yes or no.
 *
 * WHY THIS EXISTS. STOP-BANG and the ESS are asked of everyone because every
 * patient arriving at a sleep clinic is a candidate for what they measure.
 * Insomnia is different: a patient referred for snoring who sleeps soundly has
 * nothing to report, and asking them seven questions about a problem they do
 * not have is seven questions of cost for no information.
 *
 * WHY THE ANSWER IS STORED RATHER THAN USED AND DISCARDED. "Screened and has
 * no insomnia symptoms" and "was never asked" look identical on a clinician's
 * screen unless the system keeps the difference, and they are not the same
 * thing at all — the first is a finding, the second is a gap. This project
 * already separates those two ideas in the AI summary, under "สิ่งที่ตรวจแล้ว
 * ไม่พบ" and "ข้อมูลที่ยังขาด". A screening answer that lived only in the form's
 * memory would collapse them back together.
 *
 * A 'no' therefore writes a row and produces no questionnaire_scores record at
 * all. Storing a 0 instead would be the lie this codebase refuses everywhere
 * else: an unanswered instrument is not an instrument that scored zero.
 */
export const ISI_SCREENING_QUESTION_KEY = "isi_screen_sleep_difficulty";

export const ISI_SCREENING_QUESTION = {
  key: ISI_SCREENING_QUESTION_KEY,
  labelTh:
    "ในช่วงสองสัปดาห์ที่ผ่านมา คุณมีปัญหาหลับยาก ตื่นกลางดึกแล้วหลับต่อไม่ได้ หรือตื่นเช้าเกินไปหรือไม่",
  labelEn:
    "In the last two weeks, have you had difficulty falling asleep, staying asleep, or waking too early?",
  hintTh: "ถ้าไม่มี ข้ามแบบประเมินชุดนี้ได้เลย และเราจะบันทึกไว้ว่าถามแล้ว",
} as const;
