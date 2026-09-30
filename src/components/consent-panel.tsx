"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONSENT_ITEMS,
  CONSENT_WITHDRAWAL_NOTE_TH,
  type ConsentPurpose,
} from "@/lib/consent";

export interface ConsentView {
  purpose: ConsentPurpose;
  granted: boolean;
  stale: boolean;
  recordedAt: string | null;
}

interface ConsentPanelProps {
  consents: Record<ConsentPurpose, ConsentView>;
  /**
   * True when the required consent is missing, so this panel is standing in
   * the way of the questionnaire rather than sitting beside it.
   */
  blocking: boolean;
}

/**
 * The consent notice, as a thing the patient reads and answers — not a
 * checkbox beside a Sign up button.
 *
 * TWO STATES, ONE COMPONENT. Before the required consent is given this panel
 * replaces the questionnaire list entirely, because there is nothing the
 * patient can usefully do until they have decided. Afterwards it collapses to
 * a section further down the page where the choices can be changed at any
 * time. Hiding it after the first yes would make withdrawal something a
 * patient has to ask for, which is not what "withdraw at any time" means.
 *
 * WHY THERE IS NO "CLEAR THIS ANSWER" HERE, UNLIKE THE QUESTIONNAIRES
 *
 * On a questionnaire, "not answered" is a real third state that the system
 * reports differently from a zero, so an item has to be able to return to it.
 * Consent has no equivalent. Once a patient has read the notice and decided,
 * there is no honest way back to never having been asked — and the record that
 * a decision was made is the very thing the table exists to keep. Erasing it
 * would destroy the only evidence that the collection had a lawful basis.
 *
 * So changing your mind is always possible, and is itself recorded. Undoing
 * the fact that you decided is not.
 */
export function ConsentPanel({ consents, blocking }: ConsentPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ConsentPurpose | null>(null);

  /**
   * The item whose withdrawal is one more click away.
   *
   * Withdrawing is the direction that takes something away — access to the
   * questionnaire, or the AI draft the clinician was about to read — so it
   * asks once before acting. Granting does not: it is the direction that costs
   * nothing to have meant, and a confirmation step there would only train
   * people to click through dialogs.
   *
   * The same two-stage shape the questionnaires already use, so it is a
   * pattern the patient has met before rather than a new one to learn.
   */
  const [confirming, setConfirming] = useState<ConsentPurpose | null>(null);

  function decide(purpose: ConsentPurpose, granted: boolean) {
    setError(null);

    // Withdrawal asks first. Any other click anywhere cancels a pending one,
    // so a half-pressed withdrawal never sits waiting to surprise someone.
    if (!granted && confirming !== purpose) {
      setConfirming(purpose);
      return;
    }

    setConfirming(null);
    setBusy(purpose);

    startTransition(async () => {
      const res = await fetch("/api/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, granted }),
      });

      setBusy(null);

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      router.refresh();
    });
  }

  return (
    <Card className={blocking ? "border-primary/40" : undefined}>
      <CardHeader>
        <CardTitle>
          {blocking ? "ก่อนเริ่ม — ความยินยอมในการใช้ข้อมูล" : "ความยินยอมในการใช้ข้อมูล"}
        </CardTitle>
        <CardDescription>
          {blocking
            ? "ข้อมูลสุขภาพเป็นข้อมูลอ่อนไหวตามกฎหมาย ระบบจึงต้องขอความยินยอมจากท่านก่อน และบันทึกไว้ว่าท่านยินยอมอะไร เมื่อใด"
            : "ท่านเปลี่ยนใจได้ทุกเมื่อ การเปลี่ยนแปลงทุกครั้งถูกบันทึกไว้"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {CONSENT_ITEMS.map((item) => {
          const state = consents[item.purpose];
          const answered = state.recordedAt !== null && !state.stale;
          const isConfirming = confirming === item.purpose;
          const working = busy === item.purpose && isPending;

          // The option already in force is not offered again: pressing it
          // would write a row saying nothing changed. When the wording has
          // been updated both are offered, because the patient has to answer
          // the new text even if the answer is the same.
          const grantDisabled = isPending || (answered && state.granted);
          const withdrawDisabled = isPending || (answered && !state.granted);

          return (
            <div
              key={item.purpose}
              className="flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{item.titleTh}</p>
                {item.required ? (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    จำเป็น
                  </span>
                ) : (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    เลือกได้
                  </span>
                )}
                {/* Says the same thing to a patient that `stale` says to the
                    code: the wording changed, so the old answer no longer
                    describes what they agreed to. */}
                {state.stale && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    ข้อความมีการปรับปรุง กรุณายืนยันอีกครั้ง
                  </span>
                )}
              </div>

              <p className="text-sm text-muted-foreground">{item.bodyTh}</p>

              {item.ifDeclinedTh && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">หากไม่ยินยอม: </span>
                  {item.ifDeclinedTh}
                </p>
              )}

              {isConfirming && (
                <p className="text-sm text-amber-700 dark:text-amber-500">
                  {item.required
                    ? "การถอนความยินยอมข้อนี้จะทำให้ท่านทำแบบประเมินต่อไม่ได้ จนกว่าจะยินยอมใหม่"
                    : "ยืนยันว่าต้องการถอนความยินยอมข้อนี้"}
                </p>
              )}

              {/* While a withdrawal is waiting to be confirmed, the ordinary
                  controls are replaced by exactly two: do it, or don't.

                  The first version of this screen told the patient to "press
                  another button to cancel", which was wrong twice over — the
                  other button on this item is the one already in force and is
                  therefore disabled, and pressing a button on a DIFFERENT item
                  would have recorded a different consent while cancelling this
                  one. Two effects from one click, and no way out that did
                  nothing. */}
              {isConfirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isPending}
                    onClick={() => decide(item.purpose, false)}
                  >
                    {working
                      ? "กำลังบันทึก..."
                      : answered && state.granted
                        ? "ยืนยันถอนความยินยอม"
                        : "ยืนยันไม่ยินยอม"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setConfirming(null)}
                  >
                    ยกเลิก
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={answered && state.granted ? "default" : "outline"}
                    disabled={grantDisabled}
                    onClick={() => decide(item.purpose, true)}
                  >
                    {working
                      ? "กำลังบันทึก..."
                      : answered && state.granted
                        ? "✓ ยินยอม"
                        : "ยินยอม"}
                  </Button>
                  <Button
                    size="sm"
                    variant={answered && !state.granted ? "default" : "outline"}
                    disabled={withdrawDisabled}
                    onClick={() => decide(item.purpose, false)}
                  >
                    {answered && state.granted
                      ? "ถอนความยินยอม"
                      : answered && !state.granted
                        ? "✓ ไม่ยินยอม"
                        : "ไม่ยินยอม"}
                  </Button>

                  {answered && (
                    <span className="text-xs text-muted-foreground">
                      {state.granted ? "ยินยอมเมื่อ " : "ปฏิเสธเมื่อ "}
                      {new Date(state.recordedAt!).toLocaleString("th-TH")}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground">
          {CONSENT_WITHDRAWAL_NOTE_TH}
        </p>

        {/* Said out loud rather than left for a patient to discover: the
            record is permanent by design, and that protects them as much as
            it protects the hospital. */}
        <p className="text-xs text-muted-foreground">
          ทุกครั้งที่ท่านเปลี่ยนคำตอบ ระบบจะบันทึกเป็นรายการใหม่ ไม่ได้ลบรายการเดิมทิ้ง —
          เพื่อให้ตรวจสอบย้อนหลังได้ว่า ณ วันที่เก็บข้อมูลนั้น ท่านยินยอมอะไรไว้
          ท่านจึงเปลี่ยนใจได้เสมอ แต่ระบบจะไม่ลบประวัติว่าเคยตัดสินใจอย่างไร
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
