import Link from "next/link";

import { ClinicianIntakePanel } from "@/components/clinician-intake-panel";
import { Button } from "@/components/ui/button";
import type { ClinicianSessionView } from "@/services/intake/service";

/**
 * A public, read-only preview of the clinician dashboard.
 *
 * WHY THIS PAGE EXISTS
 *
 * The clinician view is where most of this project's thinking lives, but a
 * visitor can't reach it: signing up creates a `patient`, and only a manual
 * edit in the database can promote someone to `clinician`. Anyone evaluating
 * the project from the outside would therefore see half the system.
 *
 * The obvious fix — a button that lets a signed-in user switch their own role
 * — was rejected deliberately. "A patient can never self-promote to clinician"
 * is a rule this project enforces at the database level, and shipping code
 * that breaks it for the sake of a demo would undermine the very property
 * being demonstrated.
 *
 * So this page renders the SAME component the real dashboard uses, with
 * fabricated data passed in as props. It touches no database, requires no
 * session, and cannot reach a real patient's record — there is no query here
 * to reach one with.
 *
 * The four cases below are chosen to show behaviour that a single screenshot
 * can't: a flagged high-risk case, a mid-range case that is correctly NOT
 * flagged, a low-risk case, and — the interesting one — an incomplete
 * assessment whose score is a floor rather than a verdict.
 */

// ---------------------------------------------------------------------------
// FABRICATED DATA. Not patients. Not derived from anything real.
// Names are invented; values were chosen to exercise each branch of the
// scoring and flagging rules.
// ---------------------------------------------------------------------------

/** The eight ESS items, in questionnaire order, matching the scoring engine. */
const ESS_ITEMS: { field: string; label: string }[] = [
  { field: "sittingReading", label: "Sitting and reading" },
  { field: "watchingTv", label: "Watching TV" },
  { field: "sittingPublic", label: "Sitting inactive in public" },
  { field: "passengerCar", label: "Passenger in a car for an hour" },
  { field: "lyingAfternoon", label: "Lying down in the afternoon" },
  { field: "sittingTalking", label: "Sitting and talking" },
  { field: "afterLunch", label: "Sitting quietly after lunch" },
  { field: "inCarTraffic", label: "Stopped in traffic" },
];

/**
 * Builds a demo ESS result from the eight item answers.
 *
 * The total, the answered count, the ceiling and the severity band are all
 * DERIVED here rather than typed in by hand, using the same arithmetic and the
 * same cut-offs as the real engine. Hand-written demo numbers drift: someone
 * edits an answer, forgets to update the total, and the page quietly starts
 * showing a score that the system it is demonstrating would never produce.
 */
function demoEss(
  scores: (number | null)[],
  computedAt: string
): NonNullable<ClinicianSessionView["ess"]> {
  const breakdown = ESS_ITEMS.map((item, index) => ({
    field: item.field,
    position: index + 1,
    label: item.label,
    score: scores[index],
    answered: scores[index] !== null,
  }));

  const score = breakdown.reduce((sum, item) => sum + (item.score ?? 0), 0);
  const answeredCount = breakdown.filter((item) => item.answered).length;
  const missing = breakdown.length - answeredCount;

  const severity =
    score >= 16
      ? "severe"
      : score >= 13
        ? "moderate"
        : score >= 11
          ? "mild"
          : "normal";

  return {
    score,
    severity,
    incomplete: missing > 0,
    answeredCount,
    maxPossibleScore: score + missing * 3,
    breakdown,
    computedAt,
  };
}

const DEMO_SESSIONS: ClinicianSessionView[] = [
  {
    id: "demo-1",
    patientName: "สมหญิง วัฒนกุล (เคสตัวอย่าง)",
    status: "completed",
    chiefComplaint: "นอนกรนเสียงดัง คู่สมรสสังเกตว่ามีช่วงหยุดหายใจ",
    bmi: 36.2,
    createdAt: "2026-09-18T09:20:00.000Z",
    stopBang: {
      score: 6,
      riskCategory: "high",
      incomplete: false,
      answeredCount: 8,
      maxPossibleScore: 6,
      breakdown: [
        { letter: "S", label: "Snoring", scored: true, answered: true },
        { letter: "T", label: "Tired", scored: true, answered: true },
        { letter: "O", label: "Observed apnea", scored: true, answered: true },
        { letter: "P", label: "High blood pressure", scored: true, answered: true },
        { letter: "B", label: "BMI > 35", scored: true, answered: true },
        { letter: "A", label: "Age > 50", scored: true, answered: true },
        { letter: "N", label: "Neck > 40 cm", scored: false, answered: true },
        { letter: "G", label: "Male", scored: false, answered: true },
      ],
      computedAt: "2026-09-18T09:24:00.000Z",
    },
    ess: demoEss([2, 3, 2, 3, 2, 1, 2, 2], "2026-09-18T09:26:00.000Z"),
    flags: [
      {
        id: "demo-flag-1",
        flagType: "high_osa_risk",
        severity: "standard",
        triggerSource: "STOP-BANG score 6/8 (cut-off 5)",
        acknowledgedAt: null,
      },
      {
        id: "demo-flag-1b",
        flagType: "severe_sleepiness",
        severity: "standard",
        triggerSource: "ESS score 17/24 (cut-off 16)",
        acknowledgedAt: null,
      },
    ],
  },
  {
    id: "demo-2",
    patientName: "พิมพ์ชนก อารีย์ (เคสตัวอย่าง)",
    status: "in_progress",
    chiefComplaint: "ง่วงมากตอนบ่าย เคยเกือบหลับขณะรอไฟแดง",
    bmi: null,
    createdAt: "2026-09-19T14:05:00.000Z",
    stopBang: {
      score: 4,
      riskCategory: "intermediate",
      incomplete: true,
      answeredCount: 6,
      maxPossibleScore: 6,
      breakdown: [
        { letter: "S", label: "Snoring", scored: true, answered: true },
        { letter: "T", label: "Tired", scored: true, answered: true },
        { letter: "O", label: "Observed apnea", scored: false, answered: true },
        { letter: "P", label: "High blood pressure", scored: false, answered: true },
        { letter: "B", label: "BMI > 35", scored: false, answered: false },
        { letter: "A", label: "Age > 50", scored: true, answered: true },
        { letter: "N", label: "Neck > 40 cm", scored: false, answered: false },
        { letter: "G", label: "Male", scored: true, answered: true },
      ],
      computedAt: "2026-09-19T14:09:00.000Z",
    },
    ess: demoEss([3, 3, null, 2, null, 1, 2, null], "2026-09-19T14:11:00.000Z"),
    flags: [],
  },
  {
    id: "demo-3",
    patientName: "ธนวัฒน์ ศรีสุข (เคสตัวอย่าง)",
    status: "completed",
    chiefComplaint: "ภรรยาบ่นเรื่องเสียงกรนมา 6 เดือน",
    bmi: 27.4,
    createdAt: "2026-09-20T08:40:00.000Z",
    stopBang: {
      score: 4,
      riskCategory: "intermediate",
      incomplete: false,
      answeredCount: 8,
      maxPossibleScore: 4,
      breakdown: [
        { letter: "S", label: "Snoring", scored: true, answered: true },
        { letter: "T", label: "Tired", scored: true, answered: true },
        { letter: "O", label: "Observed apnea", scored: false, answered: true },
        { letter: "P", label: "High blood pressure", scored: false, answered: true },
        { letter: "B", label: "BMI > 35", scored: false, answered: true },
        { letter: "A", label: "Age > 50", scored: false, answered: true },
        { letter: "N", label: "Neck > 40 cm", scored: true, answered: true },
        { letter: "G", label: "Male", scored: true, answered: true },
      ],
      computedAt: "2026-09-20T08:43:00.000Z",
    },
    ess: demoEss([1, 1, 0, 1, 0, 0, 1, 0], "2026-09-20T08:45:00.000Z"),
    flags: [],
  },
  {
    id: "demo-4",
    patientName: "ณิชา บุญมี (เคสตัวอย่าง)",
    status: "completed",
    chiefComplaint: "หลับยาก ใช้เวลานานกว่าจะหลับ",
    bmi: 21.3,
    createdAt: "2026-09-21T19:15:00.000Z",
    stopBang: {
      score: 1,
      riskCategory: "low",
      incomplete: false,
      answeredCount: 8,
      maxPossibleScore: 1,
      breakdown: [
        { letter: "S", label: "Snoring", scored: false, answered: true },
        { letter: "T", label: "Tired", scored: true, answered: true },
        { letter: "O", label: "Observed apnea", scored: false, answered: true },
        { letter: "P", label: "High blood pressure", scored: false, answered: true },
        { letter: "B", label: "BMI > 35", scored: false, answered: true },
        { letter: "A", label: "Age > 50", scored: false, answered: true },
        { letter: "N", label: "Neck > 40 cm", scored: false, answered: true },
        { letter: "G", label: "Male", scored: false, answered: true },
      ],
      computedAt: "2026-09-21T19:18:00.000Z",
    },
    // Total 9 — comfortably "normal" — but a 3 on the traffic item. This is
    // the case the urgent rule exists for, and the reason it is keyed on the
    // item rather than on the total.
    ess: demoEss([1, 1, 1, 1, 1, 1, 0, 3], "2026-09-21T19:20:00.000Z"),
    flags: [
      {
        id: "demo-flag-4",
        flagType: "drowsy_driving",
        severity: "urgent",
        triggerSource: "ESS item 8 (stopped in traffic) = 3/3",
        acknowledgedAt: null,
      },
    ],
  },
];

export const metadata = {
  title: "ตัวอย่างหน้าจอแพทย์ — Sleep Intake Copilot",
  description:
    "หน้าตัวอย่างแบบอ่านอย่างเดียว แสดงมุมมองของแพทย์ด้วยข้อมูลสมมุติ",
};

export default function ClinicianDemoPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">มุมมองของแพทย์</h1>
          <p className="text-sm text-muted-foreground">
            หน้าตัวอย่างแบบอ่านอย่างเดียว
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/">กลับหน้าแรก</Link>
        </Button>
      </div>

      <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
        <p className="font-medium">ข้อมูลทั้งหมดในหน้านี้เป็นข้อมูลสมมุติ</p>
        <p className="mt-1 text-muted-foreground">
          ไม่ใช่ผู้ป่วยจริง ไม่ได้ดึงมาจากฐานข้อมูล และหน้านี้เข้าถึงข้อมูลผู้ป่วยจริงไม่ได้เลย
          — มีไว้เพื่อให้เห็นว่าแพทย์เห็นอะไร โดยไม่ต้องมีบัญชีผู้ใช้
        </p>
        <p className="mt-2 text-muted-foreground">
          หน้านี้ใช้คอมโพเนนต์ตัวเดียวกับหน้าจอแพทย์ของจริง ต่างกันแค่แหล่งข้อมูล
          เราไม่ทำปุ่มให้ผู้ใช้สลับสิทธิ์ตัวเองเป็นแพทย์ เพราะระบบออกแบบไว้ว่า
          ผู้ป่วยต้องเลื่อนสิทธิ์ตัวเองไม่ได้ แม้แต่ตอนสาธิต
        </p>
      </div>

      <ClinicianIntakePanel sessions={DEMO_SESSIONS} />

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">สี่เคสนี้เลือกมาเพื่อแสดงอะไร</p>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>
            เคสแรกคะแนน 6/8 เข้าเกณฑ์เสี่ยงสูง ระบบขึ้นสัญญาณเตือนพร้อมบันทึกเหตุผลว่ามาจากคะแนนเท่าไร
          </li>
          <li>
            เคสที่สองน่าสนใจที่สุด — ตอบไปแล้ว 6 จาก 8 ข้อ ได้ 4 คะแนน
            ระบบจึง<strong>ไม่</strong>สรุปว่าเสี่ยงปานกลางเฉยๆ แต่บอกด้วยว่าคะแนนนี้เป็นค่าต่ำสุด
            และอาจขึ้นถึง 6 เมื่อวัดรอบคอกับ BMI ครบ ซึ่งจะกลายเป็นเสี่ยงสูง
          </li>
          <li>
            เคสที่สามได้ 4 คะแนนเท่ากัน แต่ตอบครบทั้ง 8 ข้อ — คะแนนเท่ากันแต่ความหมายทางคลินิกต่างกัน
          </li>
          <li>
            เคสที่สี่คือเคสที่สำคัญที่สุด — STOP-BANG เพียง 1/8 และ ESS รวม 9/24
            ซึ่งอยู่ในเกณฑ์ปกติทั้งคู่ แต่ผู้ป่วยตอบข้อ 8 (งีบขณะรถติด) เต็ม 3 คะแนน
            ระบบจึงขึ้นสัญญาณเตือน<strong>ระดับด่วน</strong>เรื่องการขับขี่
            กฎข้อนี้ผูกกับคำตอบรายข้อ ไม่ใช่คะแนนรวม เพราะถ้าผูกกับคะแนนรวม
            จะพลาดคนกลุ่มนี้พอดี
          </li>
        </ul>
      </div>
    </div>
  );
}
