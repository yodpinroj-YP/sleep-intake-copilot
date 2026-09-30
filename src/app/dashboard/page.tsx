import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { IntakeSessionsPanel } from "@/components/intake-sessions-panel";
import { ClinicianIntakePanel } from "@/components/clinician-intake-panel";
import { ClinicianReviewPanel } from "@/components/clinician-review-panel";
import { ConsentPanel } from "@/components/consent-panel";
import { createClient } from "@/lib/supabase/server";
import { CONSENT_PURPOSES } from "@/lib/consent";
import {
  hasRequiredConsent,
  readConsents,
} from "@/services/consent/consent-service";
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

  // Consent is a patient-side concern only. A clinician has no consent of
  // their own to give here, and asking them for one would be noise.
  const consents = onCareTeam ? null : await readConsents(supabase, user.id);
  const mayCollect = consents ? hasRequiredConsent(consents) : false;

  // Skipped entirely when consent is missing: listing a patient's sessions is
  // reading their health data, and the point of the gate is not to do that
  // until they have agreed. In practice there is nothing to list, because the
  // same rule stopped any session being created — but the page should not
  // depend on that for its correctness.
  const sessions =
    onCareTeam || !mayCollect
      ? []
      : await listMyIntakeSessions(supabase, user.id);
  const [pendingSummaries, intakesForReview] = onCareTeam
    ? await Promise.all([
        listPendingClinicianSummaries(supabase),
        // The viewer is passed so the read can be recorded against a person.
        // `role` is the one read back from profiles above, which a patient
        // cannot edit — so what lands in the audit log is the role the
        // database believes this account held at the moment it looked.
        listIntakeSessionsForReview(supabase, {
          id: user.id,
          role: profile?.role ?? null,
        }),
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
        <>
          {/* Before the required consent exists this stands in place of the
              questionnaires; afterwards it sits below them, so withdrawing is
              always one scroll away rather than something to ask for. */}
          {!mayCollect && (
            <ConsentPanel consents={consentView(consents)} blocking />
          )}

          {mayCollect && <IntakeSessionsPanel initialSessions={sessions} />}

          {mayCollect && (
            <ConsentPanel consents={consentView(consents)} blocking={false} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Narrows the service's consent map to what the client component needs.
 *
 * The server-side shape carries `textVersion`, which is an implementation
 * detail of deciding whether an answer is stale. `stale` is the conclusion,
 * and the conclusion is the only part the browser has any use for.
 */
function consentView(
  consents: Awaited<ReturnType<typeof readConsents>> | null
) {
  const source = consents;
  return Object.fromEntries(
    CONSENT_PURPOSES.map((purpose) => [
      purpose,
      {
        purpose,
        granted: source?.[purpose].granted ?? false,
        stale: source?.[purpose].stale ?? false,
        recordedAt: source?.[purpose].recordedAt ?? null,
      },
    ])
  ) as Parameters<typeof ConsentPanel>[0]["consents"];
}
