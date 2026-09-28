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
import {
  ISI_GROUP_HEADINGS,
  ISI_OPTION_SETS,
  ISI_QUESTIONS,
  ISI_SCREENING_QUESTION,
  type IsiGroup,
  type IsiOption,
} from "@/lib/isi";

interface IsiFormProps {
  sessionId: string;
  initialHasSleepDifficulty: boolean | null;
  initialAnswers: Record<string, number>;
}

/**
 * One item's five choices, as real radio inputs.
 *
 * DIFFERENT FROM THE ESS FORM ON PURPOSE. That one shows bare numbers and
 * explains the scale once at the top, because its four option labels are long
 * sentences and repeating them eight times is a wall of text. Here the labels
 * are two or three words, and there are three different scales — an item about
 * severity, an item about satisfaction, five about impact. A single explainer
 * at the top would have to describe all three and then leave the patient to
 * remember which applies where. Showing the words on the buttons costs a
 * little width and removes that memory task entirely.
 */
function OptionChoice({
  name,
  options,
  value,
  onChange,
  onClear,
  disabled,
}: {
  name: string;
  options: IsiOption[];
  value: number | null | undefined;
  onChange: (next: number) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((opt) => {
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
              onChange={() => onChange(opt.value)}
            />
            <label
              htmlFor={id}
              className={`flex h-9 cursor-pointer items-center justify-center rounded-md border px-3 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
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

      {/* See the same control on the ESS form: an item has to be able to go
          back to unanswered, because that is a state this system reports
          differently from a zero. */}
      {typeof value === "number" && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          ล้างคำตอบข้อนี้
        </button>
      )}
    </div>
  );
}

const GROUP_ORDER: IsiGroup[] = ["recent_two_weeks", "current"];

/**
 * The patient-facing Insomnia Severity Index form.
 *
 * Opens with one screening question, and shows the seven items only if the
 * patient says they have trouble sleeping. A patient referred for snoring who
 * sleeps soundly answers once and moves on.
 *
 * THE SCREENING ANSWER IS SAVED EITHER WAY. Answering 'no' is a clinical
 * finding — the clinician's screen will say the question was asked and the
 * patient reported no symptoms — and it is stored exactly like any other
 * answer. What is *not* written is a score: an instrument that was never
 * administered has no total, and recording a 0 would be indistinguishable
 * from a patient who genuinely scored 0 on all seven items.
 *
 * As everywhere else in this project, nothing is scored in the browser.
 */
export function IsiForm({
  sessionId,
  initialHasSleepDifficulty,
  initialAnswers,
}: IsiFormProps) {
  const router = useRouter();

  const [hasDifficulty, setHasDifficulty] = useState<boolean | null>(
    initialHasSleepDifficulty
  );
  /**
   * undefined — never touched, so the request omits the key.
   * null     — cleared on purpose, sent so the server deletes the stored row.
   * number   — an answer.
   */
  const [answers, setAnswers] = useState<
    Record<string, number | null | undefined>
  >(() => ({ ...initialAnswers }));

  const [error, setError] = useState<string | null>(null);
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [saved, setSaved] = useState<
    null | "screened_out" | "symptoms_only" | "scored"
  >(null);
  const [isPending, startTransition] = useTransition();

  const answeredCount = ISI_QUESTIONS.filter(
    (q) => typeof answers[q.key] === "number"
  ).length;
  const missingCount = ISI_QUESTIONS.length - answeredCount;

  function submit(hasSleepDifficulty: boolean) {
    setError(null);

    startTransition(async () => {
      const res = await fetch(`/api/intake-sessions/${sessionId}/isi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasSleepDifficulty, answers }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      if (json.scoreWarning) {
        console.warn("Answers saved, but scoring failed:", json.scoreWarning);
      }

      setSaved(
        !hasSleepDifficulty
          ? "screened_out"
          : answeredCount === 0
            ? "symptoms_only"
            : "scored"
      );
      router.refresh();
    });
  }

  function handleSubmit() {
    if (hasDifficulty === null) {
      setError("กรุณาตอบคำถามแรกก่อน");
      return;
    }

    if (hasDifficulty === false) {
      // Nothing to confirm: there is no partial questionnaire to warn about.
      submit(false);
      return;
    }

    // A patient who reported symptoms but has answered nothing yet IS allowed
    // to save. Earlier this was refused outright, which threw away the one
    // answer they had given — the screening 'yes' — and left the clinician
    // looking at a session indistinguishable from one where the question was
    // never asked. The two-stage confirm below is enough of a guard: it warns
    // once, and only a second deliberate press saves.
    if (missingCount > 0 && !confirmPartial) {
      setConfirmPartial(true);
      setError(
        answeredCount === 0
          ? `คุณตอบว่ามีปัญหาการนอนหลับ แต่ยังไม่ได้ตอบข้อใดเลย — ` +
              `ระบบจะไม่คำนวณคะแนน แพทย์จะเห็นเพียงว่าคุณรายงานว่ามีอาการ ` +
              `กดบันทึกอีกครั้งเพื่อยืนยัน หรือเลื่อนลงไปตอบแบบประเมิน`
          : `ยังไม่ได้ตอบ ${missingCount} ข้อ — คะแนนที่แพทย์เห็นจะถูกระบุว่าเป็นค่าต่ำสุดที่เป็นไปได้ ` +
              `กดบันทึกอีกครั้งเพื่อยืนยัน หรือเลื่อนขึ้นไปตอบให้ครบ`
      );
      return;
    }

    submit(true);
  }

  if (saved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>บันทึกเรียบร้อยแล้ว</CardTitle>
          <CardDescription>
            {saved === "screened_out"
              ? "คุณตอบว่าไม่มีปัญหาการนอนหลับในช่วงสองสัปดาห์ที่ผ่านมา ระบบบันทึกคำตอบนี้ไว้ให้แพทย์เห็นแล้ว"
              : saved === "symptoms_only"
                ? "ระบบบันทึกไว้แล้วว่าคุณมีปัญหาการนอนหลับ แต่ยังไม่มีคะแนนเพราะยังไม่ได้ตอบข้อใด กลับมาตอบเมื่อไรก็ได้ก่อนถึงวันนัด"
                : missingCount > 0
                  ? `บันทึกแล้ว ${answeredCount} จาก ${ISI_QUESTIONS.length} ข้อ แพทย์จะเห็นว่าแบบประเมินนี้ยังตอบไม่ครบ`
                  : `ตอบครบทั้ง ${ISI_QUESTIONS.length} ข้อ ระบบคำนวณคะแนนและส่งให้แพทย์ตรวจสอบแล้ว`}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSaved(null);
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
          แบบประเมินความรุนแรงของอาการนอนไม่หลับ{" "}
          <span className="text-muted-foreground font-normal">(ISI)</span>
        </CardTitle>
        <CardDescription>
          {hasDifficulty === true
            ? `ตอบแล้ว ${answeredCount} จาก ${ISI_QUESTIONS.length} ข้อ`
            : "เริ่มด้วยคำถามเดียว"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-medium">{ISI_SCREENING_QUESTION.labelTh}</p>
          <p className="text-xs text-muted-foreground">
            {ISI_SCREENING_QUESTION.hintTh}
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { value: true, labelTh: "มี" },
              { value: false, labelTh: "ไม่มี" },
            ].map((opt) => {
              const id = `${ISI_SCREENING_QUESTION.key}-${String(opt.value)}`;
              const selected = hasDifficulty === opt.value;
              return (
                <div key={id}>
                  <input
                    type="radio"
                    id={id}
                    name={ISI_SCREENING_QUESTION.key}
                    className="peer sr-only"
                    checked={selected}
                    disabled={isPending}
                    onChange={() => {
                      setHasDifficulty(opt.value);
                      setConfirmPartial(false);
                      setError(null);
                    }}
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
        </div>

        {hasDifficulty === true &&
          GROUP_ORDER.map((group) => (
            <div key={group} className="flex flex-col gap-5">
              <p className="text-sm font-semibold">{ISI_GROUP_HEADINGS[group]}</p>

              {ISI_QUESTIONS.filter((q) => q.group === group).map((q) => (
                <div key={q.key} className="flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {q.position}. {q.labelTh}
                    </p>
                    {q.hintTh && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {q.hintTh}
                      </p>
                    )}
                  </div>
                  <OptionChoice
                    name={q.key}
                    options={ISI_OPTION_SETS[q.optionSet]}
                    value={answers[q.key]}
                    disabled={isPending}
                    onClear={() => {
                      setAnswers((prev) => ({ ...prev, [q.key]: null }));
                      setConfirmPartial(false);
                      setError(null);
                    }}
                    onChange={(next) => {
                      setAnswers((prev) => ({ ...prev, [q.key]: next }));
                      setConfirmPartial(false);
                      setError(null);
                    }}
                  />
                </div>
              ))}
            </div>
          ))}

        {hasDifficulty === false && (
          <p className="text-sm text-muted-foreground">
            ไม่ต้องตอบคำถามชุดนี้ต่อ กดบันทึกเพื่อยืนยันว่าไม่มีอาการ
            แพทย์จะเห็นว่าถามแล้วและคุณตอบว่าไม่มี
          </p>
        )}

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
              ? answeredCount === 0
                ? "ยืนยันบันทึกโดยยังไม่ตอบ"
                : "ยืนยันบันทึกเท่าที่ตอบ"
              : "บันทึกคำตอบ"}
        </Button>
      </CardFooter>
    </Card>
  );
}
