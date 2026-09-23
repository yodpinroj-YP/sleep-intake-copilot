import Link from "next/link";
import { redirect } from "next/navigation";

import { EssForm } from "@/components/ess-form";
import { StopBangForm } from "@/components/stopbang-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import {
  getEssAnswers,
  getMyIntakeSession,
  getStopBangAnswers,
} from "@/services/intake/service";

/**
 * The patient's questionnaire page for one intake session.
 *
 * Ownership is checked here (via getMyIntakeSession, which filters on
 * patient_id) and again by RLS on every write the form makes. A session id
 * belonging to someone else and an id that doesn't exist both redirect to the
 * dashboard, so this page can't be used to find out which ids are real.
 */
export default async function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const session = await getMyIntakeSession(supabase, user.id, id);

  if (!session) {
    redirect("/dashboard");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth, sex")
    .eq("id", user.id)
    .single();

  // Two separate queries rather than one clever join: the hand-written
  // database types declare no relationships, so a nested PostgREST select
  // silently degrades the inference and hides real mistakes. Two plain reads
  // cost one extra round trip and stay honest.
  const answers = await getStopBangAnswers(supabase, id);
  const essAnswers = await getEssAnswers(supabase, id);

  const isOpen =
    session.status === "not_started" || session.status === "in_progress";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">แบบสอบถามก่อนพบแพทย์</h1>
          <p className="text-sm text-muted-foreground">
            เริ่มเมื่อ {new Date(session.created_at).toLocaleString("th-TH")}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">กลับหน้าหลัก</Link>
        </Button>
      </div>

      {isOpen ? (
        <>
          <p className="text-sm text-muted-foreground">
            แบบสอบถามมี 2 ชุด ชุดแรกคัดกรองภาวะหยุดหายใจขณะหลับ
            ชุดที่สองประเมินความง่วงกลางวัน แต่ละชุดบันทึกแยกกัน
            ทำชุดไหนก่อนก็ได้ และกลับมาทำต่อภายหลังได้
          </p>

          <StopBangForm
            sessionId={session.id}
            initialHeightCm={session.height_cm}
            initialWeightKg={session.weight_kg}
            initialNeckCm={session.neck_circumference_cm}
            initialDateOfBirth={profile?.date_of_birth ?? null}
            initialSex={profile?.sex ?? null}
            initialAnswers={answers}
          />

          <EssForm sessionId={session.id} initialAnswers={essAnswers} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          เซสชันนี้ปิดรับคำตอบแล้ว ไม่สามารถแก้ไขได้
          หากต้องการกรอกใหม่ กรุณาเริ่มเซสชันใหม่จากหน้าหลัก
        </p>
      )}
    </div>
  );
}
