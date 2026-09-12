import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { IntakeSessionsPanel } from "@/components/intake-sessions-panel";
import { ClinicianReviewPanel } from "@/components/clinician-review-panel";
import { createClient } from "@/lib/supabase/server";
import {
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

  const isClinician = profile?.role === "clinician" || profile?.role === "admin";

  const sessions = isClinician ? [] : await listMyIntakeSessions(supabase, user.id);
  const pendingSummaries = isClinician
    ? await listPendingClinicianSummaries(supabase)
    : [];

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

      {isClinician ? (
        <ClinicianReviewPanel initialSummaries={pendingSummaries} />
      ) : (
        <IntakeSessionsPanel initialSessions={sessions} />
      )}
    </div>
  );
}
