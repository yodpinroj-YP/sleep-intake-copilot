/**
 * The consent notice: what the patient is actually agreeing to, in both
 * languages, and the version stamp that goes into the database with it.
 *
 * WHY THE TEXT LIVES IN CODE
 *
 * It has to be versioned, reviewable and diffable. Wording that governs the
 * lawful basis for holding someone's health data should go through the same
 * review as anything else that ships — visible in a pull request, attributable
 * to a commit — rather than being edited in a database row where a change
 * leaves no trace and no reviewer.
 *
 * WHY THIS FILE HAS NO IMPORTS
 *
 * Same constraint as the scoring engines and the audit vocabulary: the test
 * runner strips types but does not resolve the `@/` alias, so anything it must
 * execute has to stand alone.
 */

/**
 * Bump this whenever any wording below changes in a way that affects what the
 * patient is agreeing to.
 *
 * Every consent row stores the version that was on screen at the time. When
 * this string changes, patients are asked again — which is the entire point:
 * a consent recorded against wording nobody can reproduce proves nothing.
 *
 * Fixing a typo that does not change the meaning does not need a bump. If you
 * are unsure whether a change is cosmetic, it is not.
 */
export const CONSENT_TEXT_VERSION = "th-en-v1";

export const CONSENT_PURPOSES = ["care", "ai_summary", "research"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ConsentItem {
  purpose: ConsentPurpose;
  /** Required consents block the service; optional ones never do. */
  required: boolean;
  titleTh: string;
  titleEn: string;
  bodyTh: string;
  bodyEn: string;
  /** What the patient loses by declining. Empty for the required one. */
  ifDeclinedTh: string;
  ifDeclinedEn: string;
}

export const CONSENT_ITEMS: readonly ConsentItem[] = [
  {
    purpose: "care",
    required: true,
    titleTh: "เก็บและใช้ข้อมูลสุขภาพเพื่อการดูแลรักษาของท่าน",
    titleEn: "Collecting and using your health information for your care",
    bodyTh:
      "ข้าพเจ้ายินยอมให้เก็บ รวบรวม และใช้ข้อมูลที่ข้าพเจ้ากรอกในแบบประเมินการนอนหลับนี้ " +
      "รวมถึงส่วนสูง น้ำหนัก รอบคอ วันเดือนปีเกิด และคำตอบของแบบประเมิน " +
      "เพื่อประกอบการตรวจวินิจฉัยและการดูแลรักษาของข้าพเจ้าเอง โดยทีมแพทย์และพยาบาลที่ดูแลข้าพเจ้า",
    bodyEn:
      "I consent to the collection and use of the information I enter in these sleep " +
      "questionnaires — including height, weight, neck circumference, date of birth and my " +
      "answers — for my own assessment and care by the clinicians looking after me.",
    ifDeclinedTh: "",
    ifDeclinedEn: "",
  },
  {
    purpose: "ai_summary",
    required: false,
    titleTh: "ให้ปัญญาประดิษฐ์ช่วยเรียบเรียงสรุปให้แพทย์อ่าน",
    titleEn: "Letting AI help draft a summary for the physician",
    bodyTh:
      "ข้าพเจ้ายินยอมให้ระบบส่งข้อมูลที่ตัดข้อมูลระบุตัวตนออกแล้ว — ได้แก่ ช่วงอายุ เพศ " +
      "ค่าวัดร่างกาย และคะแนนแบบประเมิน — ไปยังผู้ให้บริการปัญญาประดิษฐ์ เพื่อช่วยเรียบเรียงสรุปให้แพทย์อ่านได้เร็วขึ้น " +
      "ระบบจะไม่ส่งชื่อ เลขประจำตัวผู้ป่วย วันเดือนปีเกิด หรือข้อความที่ข้าพเจ้าพิมพ์เอง " +
      "และแพทย์จะเป็นผู้ตรวจสอบและอนุมัติข้อความนั้นทุกครั้งก่อนเข้าเวชระเบียน",
    bodyEn:
      "I consent to the system sending de-identified information — age band, sex, body " +
      "measurements and questionnaire scores — to an AI provider to help draft a summary for " +
      "the physician. No name, hospital number, date of birth or free text I typed is sent, and " +
      "a physician reviews and approves every draft before it enters the record.",
    ifDeclinedTh:
      "หากไม่ยินยอม ท่านยังใช้ระบบได้ตามปกติทุกอย่าง คะแนนและสัญญาณเตือนทั้งหมดคำนวณโดยไม่ใช้ปัญญาประดิษฐ์อยู่แล้ว " +
      "แพทย์จะอ่านคะแนนโดยตรงแทน",
    ifDeclinedEn:
      "If you decline, everything else works exactly as before. All scores and safety flags are " +
      "computed without AI in any case; the physician simply reads them directly.",
  },
  {
    purpose: "research",
    required: false,
    titleTh: "ใช้ข้อมูลที่ตัดตัวตนออกแล้วเพื่อพัฒนาคุณภาพและการวิจัย",
    titleEn: "Using de-identified data for quality improvement and research",
    bodyTh:
      "ข้าพเจ้ายินยอมให้ใช้ข้อมูลของข้าพเจ้าในรูปแบบที่ตัดข้อมูลระบุตัวตนออกแล้ว " +
      "เพื่อการพัฒนาคุณภาพบริการและการศึกษาวิจัย โดยจะไม่มีการเผยแพร่ข้อมูลใดที่ระบุตัวข้าพเจ้าได้",
    bodyEn:
      "I consent to my data being used in de-identified form for quality improvement and " +
      "research. Nothing that could identify me will be published.",
    ifDeclinedTh: "หากไม่ยินยอม ข้อมูลของท่านจะถูกใช้เพื่อการดูแลรักษาของท่านเท่านั้น",
    ifDeclinedEn: "If you decline, your data is used only for your own care.",
  },
];

/**
 * Shown next to the controls, not buried in a policy page.
 *
 * It says plainly that withdrawal is forward-looking, because the alternative
 * — letting a patient believe a button erased their record — is the kind of
 * misunderstanding that surfaces only when it matters.
 */
export const CONSENT_WITHDRAWAL_NOTE_TH =
  "ท่านถอนความยินยอมได้ทุกเมื่อ การถอนมีผลกับการใช้ข้อมูลนับจากนั้นเป็นต้นไป " +
  "แต่ไม่ได้ลบข้อมูลที่บันทึกไว้แล้วโดยอัตโนมัติ เพราะเวชระเบียนมีระยะเวลาเก็บรักษาตามกฎหมายกำกับอยู่ " +
  "หากท่านต้องการให้ลบข้อมูล โปรดติดต่อเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคลของโรงพยาบาล";

export const CONSENT_WITHDRAWAL_NOTE_EN =
  "You may withdraw consent at any time. Withdrawal applies to use of your data from that " +
  "point onward; it does not automatically delete data already held, because medical records " +
  "carry their own legal retention periods. To request erasure, contact the hospital's data " +
  "protection officer.";

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return (
    typeof value === "string" &&
    (CONSENT_PURPOSES as readonly string[]).includes(value)
  );
}

export function requiredConsentPurposes(): ConsentPurpose[] {
  return CONSENT_ITEMS.filter((i) => i.required).map((i) => i.purpose);
}
