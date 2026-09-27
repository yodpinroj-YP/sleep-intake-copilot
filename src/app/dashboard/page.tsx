import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { IntakeSessionsPanel } from "@/components/intake-sessions-panel";
import { ClinicianIntakePanel } from "@/components/clinician-intake-panel";
import { ClinicianReviewPanel } from "@/components/clinician-review-panel";
import { createClient } from "@/lib/supabase/server";
import { isCareTeam, isPhysician } from "@/lib/roles";
import {
  listIntakeSessionsForReview,
  listMyIntakeSessions,
  listPendingClinicianSummaries,
} from "@/services/intake/service";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  const onCareTeam = isCareTeam(profile?.role);
  const canDecide = isPhysician(profile?.role);

  const sessions = onCareTeam ? [] : await listMyIntakeSessions(supabase, user.id);
  const [pendingSummaries, intakesForReview] = onCareTeam
    ? await Promise.all([
        listPendingClinicianSummaries(supabase),
        listIntakeSessionsForReview(supabase),
      ])
    : [[], []];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {profile?.full_name ?? user.email} ({profile?.role ?? "patient"})
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <Button variant="outline" type="submit">
            Sign out
          </Button>
        </form>
      </div>

      {onCareTeam ? (
        <>
          <ClinicianIntakePanel sessions={intakesForReview} />
          {/* A nurse sees the same queue and the same drafts, without the
              approve and reject controls. The database would refuse those
              writes anyway; showing buttons that fail is how an interface
              loses people's trust. */}
          <ClinicianReviewPanel
            initialSummaries={pendingSummaries}
            readOnly={!canDecide}
            readOnlyNote="เฉพาะแพทย์เท่านั้นที่อนุมัติหรือปฏิเสธร่างได้ — บัญชีนี้ดูได้อย่างเดียว"
            heading={canDecide ? "ร่างสรุปที่รอคุณตรวจสอบ" : "ร่างสรุปที่รอแพทย์ตรวจสอบ"}
          />
        </>
      ) : (
        <IntakeSessionsPanel initialSessions={sessions} />
      )}
    </div>
  );
}
