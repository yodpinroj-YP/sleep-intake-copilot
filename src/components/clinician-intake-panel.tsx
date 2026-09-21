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
};

const RISK_LABELS: Record<string, string> = {
  low: "เสี่ยงต่ำ",
  intermediate: "เสี่ยงปานกลาง",
  high: "เสี่ยงสูง",
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
 * The clinician's working list of patient intakes.
 *
 * Read-only on purpose. Acknowledging a flag and approving an AI summary are
 * both deliberate clinical actions with their own audit columns; putting them
 * behind dedicated endpoints rather than this list keeps a stray click from
 * becoming a recorded clinical decision.
 */
export function ClinicianIntakePanel({
  sessions,
}: {
  sessions: ClinicianSessionView[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient intakes</CardTitle>
        <CardDescription>
          แบบคัดกรองที่ผู้ป่วยส่งเข้ามา พร้อมคะแนน STOP-BANG ที่คำนวณด้วยกฎตายตัว
          และสัญญาณเตือนที่ระบบตรวจพบ
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
          const openFlags = session.flags.filter((f) => !f.acknowledgedAt);

          return (
            <Card
              key={session.id}
              className={
                openFlags.length > 0
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
                    ยังไม่ได้คำนวณคะแนน — ผู้ป่วยอาจยังตอบแบบสอบถามไม่เสร็จ
                  </p>
                )}

                {session.flags.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t pt-3">
                    {session.flags.map((flag) => (
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
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
