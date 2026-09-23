/**
 * Epworth Sleepiness Scale (ESS) item definitions.
 *
 * ---------------------------------------------------------------------------
 * LICENSING NOTE — READ BEFORE USING WITH REAL PATIENTS
 *
 * The ESS is copyrighted (© M.W. Johns) and is distributed under licence
 * through the Mapi Research Trust, which requires a licence whether or not a
 * fee is payable. The Thai/English strings below are DELIBERATELY NOT the
 * official item wording — they are plain-language descriptions of each
 * situation, written as placeholders so development can proceed before a
 * licence is granted.
 *
 * Before this is used with real patients, replace `labelTh` / `labelEn` and
 * the option labels with the officially licensed wording (and the official
 * Thai translation, if one exists). Nothing else in the codebase needs to
 * change: `key`, the scoring logic, the cut-offs and the database rows are all
 * independent of the wording.
 *
 * This mirrors the decision already taken for STOP-BANG in lib/stopbang.ts —
 * the same reasoning, applied consistently.
 * ---------------------------------------------------------------------------
 *
 * Unlike STOP-BANG, every ESS item is a question asked of the patient: nothing
 * here can be derived from data the system already holds. All eight items are
 * scored 0–3, so the instrument runs 0–24.
 */

export const ESS_DOMAIN = "ess";

export interface EssOption {
  /** The number written to intake_responses.answer_value. Never translate. */
  value: 0 | 1 | 2 | 3;
  labelTh: string;
}

/**
 * The four response options, shared by every item.
 *
 * ESS does not ask "how often did you doze" but "how likely are you to doze",
 * which is why the labels below are about chance rather than frequency. A
 * patient who never encounters a situation is meant to estimate how it would
 * affect them — that instruction belongs in the form, not here.
 */
export const ESS_OPTIONS: EssOption[] = [
  { value: 0, labelTh: "ไม่มีโอกาสงีบหลับเลย" },
  { value: 1, labelTh: "มีโอกาสงีบหลับเล็กน้อย" },
  { value: 2, labelTh: "มีโอกาสงีบหลับปานกลาง" },
  { value: 3, labelTh: "มีโอกาสงีบหลับสูง" },
];

export interface EssQuestion {
  /** Stable identifier — written to intake_responses.question_key. Never translate this. */
  key: string;
  /** Item position 1–8, used only for display order and the clinician breakdown. */
  position: number;
  labelTh: string;
  labelEn: string;
  hintTh?: string;
}

export const ESS_QUESTIONS: EssQuestion[] = [
  {
    key: "ess_sitting_reading",
    position: 1,
    labelTh: "ขณะนั่งอ่านหนังสือ",
    labelEn: "Sitting and reading",
  },
  {
    key: "ess_watching_tv",
    position: 2,
    labelTh: "ขณะดูโทรทัศน์",
    labelEn: "Watching TV",
  },
  {
    key: "ess_sitting_public",
    position: 3,
    labelTh: "ขณะนั่งเฉย ๆ ในที่สาธารณะ",
    labelEn: "Sitting inactive in a public place",
    hintTh: "เช่น นั่งรอในโรงพยาบาล ในโรงภาพยนตร์ หรือในที่ประชุม",
  },
  {
    key: "ess_passenger_car",
    position: 4,
    labelTh: "ขณะเป็นผู้โดยสารในรถต่อเนื่องประมาณหนึ่งชั่วโมง",
    labelEn: "Passenger in a car for an hour without a break",
    hintTh: "โดยที่รถไม่ได้จอดพักระหว่างทาง",
  },
  {
    key: "ess_lying_afternoon",
    position: 5,
    labelTh: "ขณะเอนพักในช่วงบ่ายเมื่อมีโอกาส",
    labelEn: "Lying down to rest in the afternoon",
  },
  {
    key: "ess_sitting_talking",
    position: 6,
    labelTh: "ขณะนั่งคุยกับใครสักคน",
    labelEn: "Sitting and talking to someone",
  },
  {
    key: "ess_after_lunch",
    position: 7,
    labelTh: "ขณะนั่งเงียบ ๆ หลังอาหารกลางวัน โดยไม่ได้ดื่มแอลกอฮอล์",
    labelEn: "Sitting quietly after lunch without alcohol",
  },
  {
    key: "ess_in_car_traffic",
    position: 8,
    labelTh: "ขณะอยู่ในรถที่หยุดนิ่งสองสามนาทีระหว่างการจราจร",
    labelEn: "In a car, while stopped for a few minutes in traffic",
    hintTh: "เช่น ติดไฟแดงหรือรถติด — ตอบเฉพาะกรณีที่คุณเป็นผู้ขับ",
  },
];

/** Every question key this instrument writes — used when loading saved answers back. */
export const ESS_QUESTION_KEYS = ESS_QUESTIONS.map((q) => q.key);

/**
 * The item that asks about dozing while stopped in traffic.
 *
 * Singled out as a named constant because the scoring engine treats a maximum
 * answer on this one item as a safety flag in its own right, independently of
 * the total score — see ess-scoring.ts. Referring to it by name rather than by
 * index means renumbering the items can never silently move the flag onto a
 * different question.
 */
export const ESS_DRIVING_QUESTION_KEY = "ess_in_car_traffic";
