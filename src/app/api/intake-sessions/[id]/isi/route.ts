import { NextResponse } from "next/server";

import { ISI_QUESTION_KEYS } from "@/lib/isi";
import { createClient } from "@/lib/supabase/server";
import { scoreAndSaveIsiSession } from "@/services/intake/scoring-service";
import { saveIsiIntake } from "@/services/intake/service";

/**
 * POST /api/intake-sessions/[id]/isi
 *
 * Saves the insomnia screening answer and, when the patient reported symptoms,
 * the seven Insomnia Severity Index answers, then scores them server-side.
 *
 * Mirrors the ESS route: same ownership proof, same "a scoring failure is not
 * a failed save" behaviour. The one addition is the screening answer, which is
 * required — a request that omits it is a broken client, not a patient who
 * skipped a question.
 */

/**
 * Accepts an item answer only if it is exactly 0, 1, 2, 3 or 4.
 *
 * The range is the one difference from the ESS route, and it is the reason
 * this is a separate function rather than a shared helper: a 4 is a valid ISI
 * answer and an invalid ESS one, so a single parser would have to be told
 * which instrument it was parsing, which is the kind of argument that gets
 * passed wrongly exactly once.
 *
 * `undefined` means "the client sent something that is not a valid answer",
 * which the caller rejects with a 400. `null` means "not answered", which is
 * allowed.
 */
function parseItemAnswer(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
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

  // Deliberately strict. "Has the patient been asked?" is the question this
  // whole flow exists to answer, so a missing or non-boolean value cannot be
  // quietly treated as 'no' — that would record a finding the patient never
  // gave.
  if (typeof body.hasSleepDifficulty !== "boolean") {
    return NextResponse.json(
      { error: "กรุณาตอบคำถามคัดกรองก่อน" },
      { status: 400 }
    );
  }

  const hasSleepDifficulty = body.hasSleepDifficulty;

  const rawAnswers =
    typeof body.answers === "object" && body.answers !== null
      ? (body.answers as Record<string, unknown>)
      : {};

  const answers: Record<string, number | null> = {};

  if (hasSleepDifficulty) {
    for (const key of ISI_QUESTION_KEYS) {
      const parsed = parseItemAnswer(rawAnswers[key]);

      if (parsed === undefined) {
        return NextResponse.json(
          { error: "คำตอบบางข้อไม่ถูกต้อง กรุณาเลือกใหม่อีกครั้ง" },
          { status: 400 }
        );
      }

      // Carried through, not dropped — null retracts a stored answer.
      answers[key] = parsed;
    }
  }

  let session;
  try {
    session = await saveIsiIntake(supabase, user.id, id, {
      hasSleepDifficulty,
      answers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // As in the ESS route: the save went through the patient's own RLS-bound
  // client, so reaching this line proves ownership, and only now is it safe to
  // hand the id to the service-role engine.
  try {
    const outcome = await scoreAndSaveIsiSession(id);
    return NextResponse.json({
      session,
      // The engine's own vocabulary, passed through unchanged rather than
      // flattened to a boolean. "Reported symptoms, answered nothing" and
      // "reported no symptoms" both produce no score, and a single
      // `screenedOut: true` would tell the client they were the same thing.
      isiState: outcome.state,
      score: outcome.state === "scored" ? outcome.result : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scoring failed";
    console.error(`[isi] scoring failed for session ${id}:`, message);
    return NextResponse.json({ session, scoreWarning: message });
  }
}
