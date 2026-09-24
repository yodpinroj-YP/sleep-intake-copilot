"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReviewStatus } from "@/types/database.types";

/**
 * The jsonb columns come back untyped, because that is what jsonb is.
 * `unknown` here is honest: the narrowing happens in readList below, where a
 * malformed value degrades to an empty list rather than crashing a clinician's
 * page.
 */
interface ClinicianSummary {
  id: string;
  session_id: string;
  version: number;
  summary_text: string;
  key_symptoms: unknown;
  important_negatives: unknown;
  missing_information: unknown;
  needs_verification: unknown;
  model: string;
  prompt_version?: string | null;
  status: ReviewStatus;
  created_at: string;
}

function readList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** A labelled list, rendered only when it has something in it. */
function Section({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "warning";
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p
        className={
          tone === "warning"
            ? "text-xs font-medium text-amber-700 dark:text-amber-500"
            : "text-xs font-medium"
        }
      >
        {title}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The clinician's review queue for AI-drafted summaries.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * A draft is not a summary until a clinician says it is. Until then it sits
 * here, marked as such, outside the record. Approving it is a separate,
 * recorded action with the reviewer's identity and a timestamp — which is why
 * this panel shows the whole draft rather than a preview: nobody should be
 * approving text they have not read.
 *
 * The four lists are shown in full for the same reason. "Information that is
 * missing" and "points to verify with the patient" are the parts a clinician
 * most needs before walking into the room, and hiding them behind a toggle
 * would make the convenient path the unsafe one.
 */
export function ClinicianReviewPanel({
  initialSummaries,
  readOnly = false,
}: {
  initialSummaries: ClinicianSummary[];
  /**
   * True on the public demo page. The same component renders there, with
   * fabricated data and without the approve/reject controls — a visitor has no
   * account, so those buttons could only ever fail, and a demo that shows
   * something failing teaches the wrong thing.
   *
   * Sharing the component rather than writing a second one for the demo is
   * deliberate: what a visitor sees is then literally the clinician's screen,
   * not a mock-up of it that can drift out of date.
   */
  readOnly?: boolean;
}) {
  /**
   * Which summaries this clinician has just acted on.
   *
   * The list itself is NOT copied into state. An earlier version did that —
   * `useState(initialSummaries)` — and it quietly broke the whole feature:
   * generating a draft refreshed the page data correctly, the server sent the
   * new draft down as a prop, and the component ignored it, because useState
   * only ever reads its argument on the first render. The queue stayed empty
   * and nothing anywhere reported an error.
   *
   * Rendering straight from props fixes that. This set exists only so a
   * summary disappears the moment it is approved or rejected, rather than
   * lingering until the server catches up.
   */
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const summaries = initialSummaries.filter((s) => !reviewedIds.has(s.id));

  function handleReview(id: string, decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/clinician-summaries/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "บันทึกผลการตรวจสอบไม่สำเร็จ");
        return;
      }

      // A reviewed summary leaves the queue — it is either part of the record
      // now, or explicitly rejected. Either way it is no longer pending.
      setReviewedIds((prev) => new Set(prev).add(id));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ร่างสรุปที่รอคุณตรวจสอบ</CardTitle>
        <CardDescription>
          ข้อความด้านล่างร่างโดย AI จากคะแนนที่ระบบคำนวณไว้แล้ว
          ยังไม่ถือเป็นส่วนหนึ่งของเวชระเบียนจนกว่าแพทย์จะกดอนุมัติ
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {summaries.length === 0 && !readOnly && (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีร่างที่รอการตรวจสอบ — กด &ldquo;ให้ AI ร่างสรุป&rdquo;
            ที่เคสด้านบนเพื่อสร้าง
          </p>
        )}

        {summaries.map((summary) => {
          const needsVerification = readList(summary.needs_verification);

          return (
            <Card key={summary.id} className="bg-muted/30">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm">
                    เคส {summary.session_id.slice(0, 8)} · ฉบับที่ {summary.version}
                  </CardTitle>
                  <Badge variant="secondary">รอตรวจสอบ</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(summary.created_at).toLocaleString("th-TH")} ·{" "}
                  {summary.model}
                  {summary.prompt_version ? ` · ${summary.prompt_version}` : ""}
                </p>
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                <p className="text-sm">{summary.summary_text}</p>

                <Section
                  title="ข้อค้นพบสำคัญ"
                  items={readList(summary.key_symptoms)}
                />
                <Section
                  title="สิ่งที่ตรวจแล้วไม่พบ"
                  items={readList(summary.important_negatives)}
                />
                <Section
                  title="ข้อมูลที่ยังขาด"
                  items={readList(summary.missing_information)}
                />
                <Section
                  title="ต้องยืนยันกับผู้ป่วยก่อนเชื่อถือ"
                  items={needsVerification}
                  tone="warning"
                />
              </CardContent>

              <CardFooter className="flex-wrap gap-2">
                {readOnly ? (
                  <span className="text-xs text-muted-foreground">
                    ในระบบจริง แพทย์จะเห็นปุ่มอนุมัติและปฏิเสธตรงนี้
                    และการตัดสินใจจะถูกบันทึกพร้อมชื่อผู้ตรวจและเวลา
                  </span>
                ) : (
                  <>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleReview(summary.id, "approved")}
                    >
                      อนุมัติ
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleReview(summary.id, "rejected")}
                    >
                      ปฏิเสธ
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      การตัดสินใจนี้ถูกบันทึกพร้อมชื่อผู้ตรวจและเวลา
                    </span>
                  </>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
