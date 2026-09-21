"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STOPBANG_QUESTIONS } from "@/lib/stopbang";

interface StopBangFormProps {
  sessionId: string;
  initialHeightCm: number | null;
  initialWeightKg: number | null;
  initialNeckCm: number | null;
  initialDateOfBirth: string | null;
  initialSex: "male" | "female" | "other" | null;
  initialAnswers: Record<string, boolean>;
}

type Sex = "male" | "female" | "other";

const SEX_OPTIONS: { value: Sex; labelTh: string }[] = [
  { value: "male", labelTh: "ชาย" },
  { value: "female", labelTh: "หญิง" },
  { value: "other", labelTh: "อื่น ๆ" },
];

/** A yes/no pair rendered as two real radio inputs, so it works with a keyboard and a screen reader. */
function YesNo({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: boolean | undefined;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const options: { label: string; val: boolean }[] = [
    { label: "ใช่", val: true },
    { label: "ไม่ใช่", val: false },
  ];

  return (
    <div className="flex gap-2">
      {options.map((opt) => {
        const id = `${name}-${opt.val}`;
        const selected = value === opt.val;
        return (
          <div key={id}>
            <input
              type="radio"
              id={id}
              name={name}
              className="peer sr-only"
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(opt.val)}
            />
            <label
              htmlFor={id}
              className={`flex h-9 min-w-20 cursor-pointer items-center justify-center rounded-md border px-4 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-muted"
              }`}
            >
              {opt.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The patient-facing STOP-BANG form, in two steps.
 *
 * Step 1 collects the measurements that answer four of the eight items
 * without asking the patient anything (BMI from height/weight, age from date
 * of birth, sex, and neck circumference). Step 2 asks the remaining four.
 *
 * Nothing here computes a score. The form's only job is to record what the
 * patient said; the score is calculated server-side so that the number a
 * clinician reads can never have been edited in a browser.
 */
export function StopBangForm({
  sessionId,
  initialHeightCm,
  initialWeightKg,
  initialNeckCm,
  initialDateOfBirth,
  initialSex,
  initialAnswers,
}: StopBangFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);

  const [heightCm, setHeightCm] = useState(initialHeightCm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(initialWeightKg?.toString() ?? "");
  const [neckCm, setNeckCm] = useState(initialNeckCm?.toString() ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth ?? "");
  const [sex, setSex] = useState<Sex | "">(initialSex ?? "");

  const [answers, setAnswers] = useState<Record<string, boolean | undefined>>(
    () => ({ ...initialAnswers })
  );

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function goToQuestions() {
    if (!heightCm || !weightKg) {
      setError("กรุณากรอกส่วนสูงและน้ำหนัก");
      return;
    }
    if (!dateOfBirth) {
      setError("กรุณากรอกวันเดือนปีเกิด");
      return;
    }
    if (!sex) {
      setError("กรุณาเลือกเพศ");
      return;
    }
    setError(null);
    setStep(2);
  }

  function handleSubmit() {
    const unanswered = STOPBANG_QUESTIONS.filter(
      (q) => typeof answers[q.key] !== "boolean"
    );

    if (unanswered.length > 0) {
      setError(`ยังตอบไม่ครบ เหลืออีก ${unanswered.length} ข้อ`);
      return;
    }

    setError(null);

    startTransition(async () => {
      const res = await fetch(`/api/intake-sessions/${sessionId}/stopbang`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heightCm: heightCm === "" ? null : Number(heightCm),
          weightKg: weightKg === "" ? null : Number(weightKg),
          neckCircumferenceCm: neckCm === "" ? null : Number(neckCm),
          dateOfBirth,
          sex,
          answers,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      // The answers are saved either way. A scoring failure is a developer
      // problem, not something to put in front of a patient — the server
      // logs it too (look for "[stopbang] scoring failed" in the terminal).
      if (json.scoreWarning) {
        console.warn("Answers saved, but scoring failed:", json.scoreWarning);
      }

      setSaved(true);
      router.refresh();
    });
  }

  if (saved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>บันทึกคำตอบเรียบร้อยแล้ว</CardTitle>
          <CardDescription>
            ข้อมูลของคุณถูกบันทึกไว้แล้ว ขั้นตอนถัดไประบบจะคำนวณคะแนนความเสี่ยง
            และส่งให้แพทย์ตรวจสอบ
          </CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button onClick={() => router.push("/dashboard")}>
            กลับไปหน้าหลัก
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSaved(false);
              setStep(1);
            }}
          >
            แก้ไขคำตอบ
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          แบบคัดกรองภาวะหยุดหายใจขณะหลับ{" "}
          <span className="text-muted-foreground font-normal">
            (STOP-BANG)
          </span>
        </CardTitle>
        <CardDescription>
          ขั้นที่ {step} จาก 2 —{" "}
          {step === 1 ? "ข้อมูลร่างกาย" : "คำถาม 4 ข้อ"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {step === 1 ? (
          <>
            <p className="text-sm text-muted-foreground">
              ข้อมูลส่วนนี้ช่วยตอบคำถามไปแล้ว 4 ข้อจาก 8 ข้อ
              โดยคุณไม่ต้องตอบเพิ่ม
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="heightCm">ส่วนสูง (เซนติเมตร)</Label>
                <Input
                  id="heightCm"
                  type="number"
                  inputMode="decimal"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="เช่น 168"
                  disabled={isPending}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="weightKg">น้ำหนัก (กิโลกรัม)</Label>
                <Input
                  id="weightKg"
                  type="number"
                  inputMode="decimal"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  placeholder="เช่น 72"
                  disabled={isPending}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="neckCm">รอบคอ (เซนติเมตร)</Label>
                <Input
                  id="neckCm"
                  type="number"
                  inputMode="decimal"
                  value={neckCm}
                  onChange={(e) => setNeckCm(e.target.value)}
                  placeholder="ไม่ทราบก็เว้นว่างได้"
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  วัดรอบคอตรงระดับลูกกระเดือก ถ้าไม่มีสายวัดให้เว้นว่างไว้ก่อนได้
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="dateOfBirth">วันเดือนปีเกิด</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium mb-2">เพศ</legend>
              <div className="flex gap-2">
                {SEX_OPTIONS.map((opt) => {
                  const id = `sex-${opt.value}`;
                  const selected = sex === opt.value;
                  return (
                    <div key={id}>
                      <input
                        type="radio"
                        id={id}
                        name="sex"
                        className="peer sr-only"
                        checked={selected}
                        disabled={isPending}
                        onChange={() => setSex(opt.value)}
                      />
                      <label
                        htmlFor={id}
                        className={`flex h-9 min-w-20 cursor-pointer items-center justify-center rounded-md border px-4 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted"
                        }`}
                      >
                        {opt.labelTh}
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : (
          <div className="flex flex-col gap-6">
            {STOPBANG_QUESTIONS.map((q, index) => (
              <div key={q.key} className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {index + 1}. {q.labelTh}{" "}
                    <span className="text-muted-foreground font-normal">
                      ({q.labelEn})
                    </span>
                  </p>
                  {q.hintTh && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {q.hintTh}
                    </p>
                  )}
                </div>
                <YesNo
                  name={q.key}
                  value={answers[q.key]}
                  disabled={isPending}
                  onChange={(next) =>
                    setAnswers((prev) => ({ ...prev, [q.key]: next }))
                  }
                />
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>

      <CardFooter className="gap-2">
        {step === 1 ? (
          <Button onClick={goToQuestions} disabled={isPending}>
            ถัดไป
          </Button>
        ) : (
          <>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? "กำลังบันทึก..." : "บันทึกคำตอบ"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(1);
              }}
              disabled={isPending}
            >
              ย้อนกลับ
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
