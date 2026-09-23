import { NextResponse } from "next/server";

import { ESS_QUESTION_KEYS } from "@/lib/ess";
import { createClient } from "@/lib/supabase/server";
import { scoreAndSaveEssSession } from "@/services/intake/scoring-service";
import { saveEssIntake } from "@/services/intake/service";

/**
 * POST /api/intake-sessions/[id]/ess
 *
 * Saves the eight Epworth Sleepiness Scale answers for one session, then
 * scores them server-side.
 *
 * Mirrors the STOP-BANG route deliberately — same ownership proof, same
 * "a scoring failure is not a failed save" behaviour — so there is one pattern
 * to understand rather than two.
 */

/**
 * Accepts an item answer only if it is exactly 0, 1, 2 or 3.
 *
 * Returns `undefined` for "the client sent something that isn't a valid
 * answer", which the caller rejects with a 400, and `null` for "not answered",
 * which is allowed: a patient who cannot judge one situation should still be
 * able to submit the rest. Note the difference from a silent skip — a value
 * of 7 or "2" means the client is broken, and quietly discarding it would hide
 * a bug that produces wrong clinical scores.
 */
function parseItemAnswer(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return undefined;
}

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

  const rawAnswers =
    typeof body.answers === "object" && body.answers !== null
      ? (body.answers as Record<string, unknown>)
      : {};

  const answers: Record<string, number> = {};

  for (const key of ESS_QUESTION_KEYS) {
    const parsed = parseItemAnswer(rawAnswers[key]);

    if (parsed === undefined) {
      return NextResponse.json(
        { error: "คำตอบบางข้อไม่ถูกต้อง กรุณาเลือกใหม่อีกครั้ง" },
        { status: 400 }
      );
    }

    if (parsed !== null) {
      answers[key] = parsed;
    }
  }

  let session;
  try {
    session = await saveEssIntake(supabase, user.id, id, { answers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // The save above went through the patient's own RLS-bound client, so
  // reaching this line proves the caller owns this session. Only now is it
  // safe to hand the id to the service-role scoring engine, which bypasses
  // RLS and therefore cannot check ownership for itself.
  //
  // A scoring failure must not be reported as a failed save: the answers are
  // already stored and can always be re-scored, and telling a patient to fill
  // in eight questions again would be wrong.
  try {
    const { result } = await scoreAndSaveEssSession(id);
    return NextResponse.json({ session, score: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scoring failed";
    console.error(`[ess] scoring failed for session ${id}:`, message);
    return NextResponse.json({ session, scoreWarning: message });
  }
}
