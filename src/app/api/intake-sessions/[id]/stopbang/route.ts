import { NextResponse } from "next/server";

import { STOPBANG_QUESTION_KEYS } from "@/lib/stopbang";
import { createClient } from "@/lib/supabase/server";
import { scoreAndSaveStopBangSession } from "@/services/intake/scoring-service";
import { saveStopBangIntake } from "@/services/intake/service";

/**
 * Parses one optional measurement. Returns `undefined` for "the client sent
 * something that isn't a usable measurement" so the caller can reject it,
 * and `null` for "deliberately left blank", which is allowed — a patient
 * without a tape measure should still be able to submit the rest of the form.
 *
 * The upper bounds are sanity limits, not clinical ones: they exist to catch
 * a slipped decimal point or a value typed into the wrong field.
 */
function parseMeasurement(
  value: unknown,
  max: number
): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (n <= 0 || n > max) return undefined;

  return n;
}

/**
 * POST /api/intake-sessions/[id]/stopbang
 *
 * Saves the whole STOP-BANG form in one request: physical measurements, the
 * patient's date of birth and sex, and the four yes/no answers.
 *
 * Once the answers are saved, scoring runs server-side with the service-role
 * client (see services/intake/scoring-service.ts). The score is never
 * calculated in, or accepted from, the browser — a clinician has to be able
 * to trust that the number came from the tested scoring engine.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const heightCm = parseMeasurement(body.heightCm, 260);
  const weightKg = parseMeasurement(body.weightKg, 400);
  const neckCircumferenceCm = parseMeasurement(body.neckCircumferenceCm, 90);

  if (
    heightCm === undefined ||
    weightKg === undefined ||
    neckCircumferenceCm === undefined
  ) {
    return NextResponse.json(
      { error: "ตัวเลขส่วนสูง น้ำหนัก หรือรอบคอไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" },
      { status: 400 }
    );
  }

  const dateOfBirth =
    typeof body.dateOfBirth === "string" && body.dateOfBirth !== ""
      ? body.dateOfBirth
      : null;

  if (dateOfBirth !== null && Number.isNaN(Date.parse(dateOfBirth))) {
    return NextResponse.json(
      { error: "วันเดือนปีเกิดไม่ถูกต้อง" },
      { status: 400 }
    );
  }

  const sex =
    body.sex === "male" || body.sex === "female" || body.sex === "other"
      ? body.sex
      : null;

  const rawAnswers =
    typeof body.answers === "object" && body.answers !== null
      ? (body.answers as Record<string, unknown>)
      : {};

  const answers: Record<string, boolean> = {};
  for (const key of STOPBANG_QUESTION_KEYS) {
    if (typeof rawAnswers[key] === "boolean") {
      answers[key] = rawAnswers[key] as boolean;
    }
  }

  let session;
  try {
    session = await saveStopBangIntake(supabase, user.id, id, {
      heightCm,
      weightKg,
      neckCircumferenceCm,
      dateOfBirth,
      sex,
      answers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // The save above went through the patient's own RLS-bound client, so
  // reaching this line proves the caller owns this session. Only now is it
  // safe to hand the id to the service-role scoring engine, which bypasses
  // RLS and therefore cannot check ownership for itself.
  //
  // A scoring failure must not be reported as a failed save: the patient's
  // answers are already stored, and telling them to re-enter everything would
  // be wrong. The score can always be recomputed from the saved rows, so this
  // returns a warning instead and the clinician view shows "not scored yet".
  try {
    const { result } = await scoreAndSaveStopBangSession(id);
    return NextResponse.json({ session, score: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scoring failed";
    console.error(`[stopbang] scoring failed for session ${id}:`, message);
    return NextResponse.json({ session, scoreWarning: message });
  }
}
