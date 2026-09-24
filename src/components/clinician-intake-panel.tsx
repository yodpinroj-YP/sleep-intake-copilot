import { GenerateSummaryButton } from "@/components/generate-summary-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ClinicianSessionView } from "@/services/intake/service";

const FLAG_LABELS: Record<string, string> = {
  high_osa_risk: "เสี่ยง OSA สูง — ควรพิจารณาส่งตรวจ sleep study",
  severe_sleepiness: "ง่วงกลางวันระดับรุนแรง",
  drowsy_driving: "เสี่ยงหลับขณะขับรถ — ควรติดต่อผู้ป่วยและแนะนำเรื่องการขับขี่",
};

const RISK_LABELS: Record<string, string> = {
  low: "เสี่ยงต่ำ",
  intermediate: "เสี่ยงปานกลาง",
  high: "เสี่ยงสูง",
};

const ESS_SEVERITY_LABELS: Record<string, string> = {
  normal: "ง่วงปกติ",
  mild: "ง่วงเล็กน้อย",
  moderate: "ง่วงปานกลาง",
  severe: "ง่วงรุนแรง",
};

/**
 * Compact STOP-BANG breakdown: the eight letters, each showing whether it
 * scored, was answered-and-negative, or was never answered.
 *
 * Three states, not two — the distinction between "no" and "not asked" is the
 * whole reason a clinician can tell a genuine low score from a thin one, so it
 * has to survive into the UI rather than collapsing into "not scored".
 */
function ScoreBreakdown({
  items,
}: {
  items: { letter: string; label: string; scored: boolean; answered: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => {
        const style = item.scored
          ? "bg-foreground text-background border-foreground"
          : item.answered
            ? "bg-background text-muted-foreground border-input"
            : "bg-background text-muted-foreground/50 border-dashed border-muted-foreground/40";

        return (
          <span
            key={item.letter}
            title={`${item.label} — ${
              !item.answered ? "ไม่ได้ตอบ" : item.scored ? "ได้ 1 คะแนน" : "ไม่ได้คะแนน"
            }`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded border text-[11px] font-semibold ${style}`}
          >
            {item.letter}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Compact ESS breakdown: the eight items, each showing the score it was given.
 *
 * Shows the number rather than a filled/empty mark, because unlike STOP-BANG
 * an ESS item is not a yes/no — a row of 3s and a row of 1s can reach similar
 * totals by very different routes, and which situations the patient dozes in
 * is clinically informative on its own.
 *
 * The darker the cell, the higher the answer; a dashed outline means the item
 * was never answered, which is not the same as a 0 and must not look like one.
 */
function EssBreakdown({
  items,
}: {
  items: {
    field: string;
    position: number;
    label: string;
    score: number | null;
    answered: boolean;
  }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => {
        const style = !item.answered
          ? "bg-background text-muted-foreground/50 border-dashed border-muted-foreground/40"
          : item.score === 0
            ? "bg-background text-muted-foreground border-input"
            : item.score === 1
              ? "bg-foreground/20 text-foreground border-foreground/30"
              : item.score === 2
                ? "bg-foreground/50 text-background border-foreground/60"
                : "bg-foreground text-background border-foreground";

        return (
          <span
            key={item.field}
            title={`${item.position}. ${item.label} — ${
              item.answered ? `${item.score} คะแนน` : "ไม่ได้ตอบ"
            }`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded border text-[11px] font-semibold tabular-nums ${style}`}
          >
            {item.answered ? item.score : "–"}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The clinician's working list of patient intakes.
 *
 * Read-only on purpose. Acknowledging a flag and approving an AI summary are
 * both deliberate clinical actions with their own audit columns; putting them
 * behind dedicated endpoints rather than this list keeps a stray click from
 * becoming a recorded clinical decision.
 */
export function ClinicianIntakePanel({
  sessions,
  allowActions = true,
}: {
  sessions: ClinicianSessionView[];
  /**
   * False on the public demo page, where the sessions are fabricated and no
   * request could succeed anyway. Rendering a button that always fails would
   * teach a visitor that the system is broken, which is the opposite of what
   * a demo is for.
   */
  allowActions?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient intakes</CardTitle>
        <CardDescription>
          แบบคัดกรองที่ผู้ป่วยส่งเข้ามา พร้อมคะแนน STOP-BANG และ ESS
          ที่คำนวณด้วยกฎตายตัว และสัญญาณเตือนที่ระบบตรวจพบ
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีแบบคัดกรองจากผู้ป่วย
          </p>
        )}

        {sessions.map((session) => {
          const risk = session.stopBang?.riskCategory ?? null;
          const essSeverity = session.ess?.severity ?? null;
          const openFlags = session.flags.filter((f) => !f.acknowledgedAt);

          // An unacknowledged urgent flag gets a stronger treatment than a
          // standard one. Before ESS every flag was 'standard', so one shade of
          // red was enough; now that a case can mean "contact this patient
          // about driving", a queue where everything looks equally alarming
          // would hide exactly the case that cannot wait.
          const hasOpenUrgent = openFlags.some((f) => f.severity === "urgent");

          // Urgent first, then unacknowledged, so the top of each card is the
          // thing most likely to need action.
          const sortedFlags = [...session.flags].sort((a, b) => {
            const urgency =
              Number(b.severity === "urgent") - Number(a.severity === "urgent");
            if (urgency !== 0) return urgency;
            return Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt);
          });

          return (
            <Card
              key={session.id}
              className={
                hasOpenUrgent
                  ? "border-destructive bg-destructive/10"
                  : openFlags.length > 0
                    ? "border-destructive/50 bg-destructive/5"
                    : "bg-muted/30"
              }
            >
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">
                      {session.patientName ?? "ไม่ระบุชื่อ"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(session.createdAt).toLocaleString("th-TH")}
                      {session.bmi !== null && ` · BMI ${session.bmi}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {risk && (
                      <Badge
                        variant={
                          risk === "high"
                            ? "destructive"
                            : risk === "intermediate"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {RISK_LABELS[risk] ?? risk}
                      </Badge>
                    )}
                    {essSeverity && essSeverity !== "normal" && (
                      <Badge
                        variant={
                          essSeverity === "severe" ? "destructive" : "secondary"
                        }
                      >
                        {ESS_SEVERITY_LABELS[essSeverity] ?? essSeverity}
                      </Badge>
                    )}
                    <Badge variant="outline">
                      {session.status.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3 text-sm">
                {session.chiefComplaint && (
                  <p className="text-muted-foreground">
                    อาการหลัก: {session.chiefComplaint}
                  </p>
                )}

                {session.stopBang ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium tabular-nums">
                        STOP-BANG {session.stopBang.score} / 8
                      </span>
                      {session.stopBang.incomplete && (
                        <span className="text-xs text-muted-foreground">
                          ตอบ {session.stopBang.answeredCount} จาก 8 ข้อ —
                          คะแนนนี้เป็นค่าต่ำสุด อาจสูงได้ถึง{" "}
                          <strong className="tabular-nums">
                            {session.stopBang.maxPossibleScore}
                          </strong>{" "}
                          เมื่อข้อมูลครบ
                        </span>
                      )}
                    </div>
                    <ScoreBreakdown items={session.stopBang.breakdown} />
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    ยังไม่ได้คำนวณคะแนน STOP-BANG — ผู้ป่วยอาจยังตอบไม่เสร็จ
                  </p>
                )}

                {session.ess ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium tabular-nums">
                        ESS {session.ess.score} / 24
                      </span>
                      {session.ess.incomplete && (
                        <span className="text-xs text-muted-foreground">
                          ตอบ {session.ess.answeredCount} จาก 8 ข้อ —
                          คะแนนนี้เป็นค่าต่ำสุด อาจสูงได้ถึง{" "}
                          <strong className="tabular-nums">
                            {session.ess.maxPossibleScore}
                          </strong>{" "}
                          เมื่อตอบครบ
                        </span>
                      )}
                    </div>
                    <EssBreakdown items={session.ess.breakdown} />
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    ยังไม่ได้คำนวณคะแนน ESS — ผู้ป่วยยังไม่ได้ทำแบบประเมินความง่วง
                  </p>
                )}

                {session.flags.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t pt-3">
                    {sortedFlags.map((flag) => (
                      <div key={flag.id} className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              flag.severity === "urgent"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {flag.severity === "urgent" ? "ด่วน" : "เฝ้าระวัง"}
                          </Badge>
                          <span className="font-medium">
                            {FLAG_LABELS[flag.flagType] ?? flag.flagType}
                          </span>
                          {flag.acknowledgedAt && (
                            <span className="text-xs text-muted-foreground">
                              (รับทราบแล้ว)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          เหตุผล: {flag.triggerSource}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {allowActions && (
                  <div className="border-t pt-3">
                    <GenerateSummaryButton sessionId={session.id} />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
