import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generateSummaryForSession } from "@/services/ai/summary-service";

/**
 * POST /api/intake-sessions/[id]/summary
 *
 * Asks the model for a draft summary of one session and files it for review.
 *
 * CLINICIAN ONLY, AND CHECKED HERE.
 *
 * Every other write path in this application is protected by RLS, so a mistake
 * in a route is caught by the database. This one is not: the generator uses
 * the service-role client, which bypasses RLS entirely, because
 * `clinician_summaries` accepts no writes from `authenticated` at all. The
 * check below is therefore the only thing standing between a signed-in patient
 * and the ability to spend the project's AI quota — or to read, through the
 * response, a summary of a session that is not theirs.
 *
 * The role is read from `profiles`, which a patient cannot edit: the column is
 * revoked from `authenticated` in 0001_init.sql precisely so nobody can
 * promote themselves.
 */
/**
 * A model that reasons before answering can take the best part of a minute on
 * a long prompt. The platform's default function timeout is shorter than that,
 * and it kills the request without any message the user can act on — so this
 * route asks for the longer ceiling explicitly, matching the timeout the AI
 * client enforces for itself.
 */
export const maxDuration = 60;

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "clinician" && profile?.role !== "admin") {
    // Deliberately the same shape of answer a patient would get for a session
    // that does not exist: this endpoint should not confirm to a patient that
    // a given session id is real.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const outcome = await generateSummaryForSession(id);
    return NextResponse.json({ summary: outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    const name = err instanceof Error ? err.name : "";

    // 409 for "the system is in a state where this request does not make
    // sense", which is a different thing from "you sent something invalid" and
    // leads the clinician to a different action.
    const status =
      name === "PendingSummaryExistsError" || name === "NothingToSummariseError"
        ? 409
        : 500;

    console.error(`[summary] generation failed for session ${id}:`, message);
    return NextResponse.json({ error: message }, { status });
  }
}
