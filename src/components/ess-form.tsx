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
import { ESS_OPTIONS, ESS_QUESTIONS } from "@/lib/ess";

interface EssFormProps {
  sessionId: string;
  initialAnswers: Record<string, number>;
}

/**
 * One item's four choices, as real radio inputs.
 *
 * The visible label is the number, not the sentence, because eight questions
 * times four sentences is a wall of text that patients stop reading by item
 * three — the scale is explained once above the list instead. The full wording
 * still reaches assistive technology through aria-label, and appears as a
 * tooltip on hover.
 */
function ScaleChoice({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: number | undefined;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ESS_OPTIONS.map((opt) => {
        const id = `${name}-${opt.value}`;
        const selected = value === opt.value;
        return (
          <div key={id}>
            <input
              type="radio"
              id={id}
              name={name}
              className="peer sr-only"
              checked={selected}
              disabled={disabled}
              aria-label={opt.labelTh}
              onChange={() => onChange(opt.value)}
            />
            <label
              htmlFor={id}
              title={opt.labelTh}
              className={`flex h-9 min-w-16 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-muted"
              }`}
            >
              <span className="font-medium tabular-nums">{opt.value}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The patient-facing Epworth Sleepiness Scale form.
 *
 * One step, eight items, no measurements — unlike STOP-BANG, nothing here can
 * be derived from data the system already holds.
 *
 * As with every other form in this project, nothing is scored in the browser.
 * The form records what the patient said and the server works out what it
 * means, so the number a clinician reads cannot have been edited on the way.
 *
 * ON SUBMITTING AN INCOMPLETE FORM: the patient is allowed to, but only after
 * being told what it costs. The scoring engine treats a missing item as a gap
 * rather than a zero, so an incomplete total is reported to the clinician as a
 * floor — and the clinician sees how high it could still go. Forcing all eight
 * answers would look tidier and produce worse data: a patient who cannot judge
 * one situation would guess, and a guess is indistinguishable from an answer
 * once it is in the database.
 */
export function EssForm({ sessionId, initialAnswers }: EssFormProps) {
  const router = useRouter();

  const [answers, setAnswers] = useState<Record<string, number | undefined>>(
    () => ({ ...initialAnswers })
  );

  const [error, setError] = useState<string | null>(null);
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const answeredCount = ESS_QUESTIONS.filter(
    (q) => typeof answers[q.key] === "number"
  ).length;

  const missingCount = ESS_QUESTIONS.length - answeredCount;

  function submit() {
    setError(null);

    startTransition(async () => {
      const res = await fetch(`/api/intake-sessions/${sessionId}/ess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      // The answers are saved either way. A scoring failure is a developer
      // problem, not something to put in front of a patient — the server logs
      // it too (look for "[ess] scoring failed").
      if (json.scoreWarning) {
        console.warn("Answers saved, but scoring failed:", json.scoreWarning);
      }

      setSaved(true);
      router.refresh();
    });
  }

  function handleSubmit() {
    if (answeredCount === 0) {
      setError("กรุณาตอบอย่างน้อยหนึ่งข้อก่อนบันทึก");
      return;
    }

    if (missingCount > 0 && !confirmPartial) {
      setConfirmPartial(true);
      setError(
        `ยังไม่ได้ตอบ ${missingCount} ข้อ — คะแนนที่แพทย์เห็นจะถูกระบุว่าเป็นค่าต่ำสุดที่เป็นไปได้ ` +
          `กดบันทึกอีกครั้งเพื่อยืนยัน หรือเลื่อนขึ้นไปตอบให้ครบ`
      );
      return;
    }

    submit();
  }

  if (saved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>บันทึกแบบประเมินความง่วงเรียบร้อยแล้ว</CardTitle>
          <CardDescription>
            {missingCount > 0
              ? `บันทึกแล้ว ${answeredCount} จาก 8 ข้อ แพทย์จะเห็นว่าแบบประเมินนี้ยังตอบไม่ครบ`
              : "ตอบครบทั้ง 8 ข้อ ระบบคำนวณคะแนนและส่งให้แพทย์ตรวจสอบแล้ว"}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSaved(false);
              setConfirmPartial(false);
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
          แบบประเมินความง่วงนอนกลางวัน{" "}
          <span className="text-muted-foreground font-normal">(ESS)</span>
        </CardTitle>
        <CardDescription>
          ตอบแล้ว {answeredCount} จาก {ESS_QUESTIONS.length} ข้อ
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            ในสถานการณ์ต่อไปนี้ คุณมีโอกาส<strong>งีบหลับ</strong>มากน้อยเพียงใด
            ไม่ใช่แค่รู้สึกเหนื่อย — ให้นึกถึงช่วงหลายเดือนที่ผ่านมา
            หากบางสถานการณ์คุณไม่เคยเจอ ให้ประมาณว่าน่าจะเป็นอย่างไร
          </p>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {ESS_OPTIONS.map((opt) => (
              <li key={opt.value}>
                <span className="font-medium tabular-nums text-foreground">
                  {opt.value}
                </span>{" "}
                = {opt.labelTh}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-6">
          {ESS_QUESTIONS.map((q) => (
            <div key={q.key} className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium">
                  {q.position}. {q.labelTh}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({q.labelEn})
                  </span>
                </p>
                {q.hintTh && (
                  <p className="text-xs text-muted-foreground mt-1">{q.hintTh}</p>
                )}
              </div>
              <ScaleChoice
                name={q.key}
                value={answers[q.key]}
                disabled={isPending}
                onChange={(next) => {
                  setAnswers((prev) => ({ ...prev, [q.key]: next }));
                  // Any new answer invalidates a pending "submit anyway":
                  // the patient is still filling the form in.
                  setConfirmPartial(false);
                  setError(null);
                }}
              />
            </div>
          ))}
        </div>

        {error && (
          <p
            className={
              confirmPartial
                ? "text-sm text-amber-700 dark:text-amber-500"
                : "text-sm text-destructive"
            }
          >
            {error}
          </p>
        )}
      </CardContent>

      <CardFooter>
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending
            ? "กำลังบันทึก..."
            : confirmPartial
              ? "ยืนยันบันทึกเท่าที่ตอบ"
              : "บันทึกคำตอบ"}
        </Button>
      </CardFooter>
    </Card>
  );
}
