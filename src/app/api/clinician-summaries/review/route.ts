import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { reviewClinicianSummary } from "@/services/intake/service";

/**
 * POST /api/clinician-summaries/review
 * Body: { id: string, decision: "approved" | "rejected" }
 *
 * Lets a signed-in clinician approve or reject an AI-generated summary.
 * RLS also enforces the clinician-only check at the database level (see
 * supabase/migrations/0001_init.sql), this is defense in depth.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; decision?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id || (body.decision !== "approved" && body.decision !== "rejected")) {
    return NextResponse.json(
      { error: "`id` (string) and `decision` ('approved' | 'rejected') are required" },
      { status: 400 }
    );
  }

  // Read for the audit log, not for authorization — RLS and the column grants
  // in 0001/0007 are what actually decide whether this write is allowed. What
  // the log needs is the role the actor held at the moment they decided, which
  // is not recoverable later if the account is changed or removed.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  try {
    const summary = await reviewClinicianSummary(
      supabase,
      user.id,
      profile?.role ?? null,
      body.id,
      body.decision
    );
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Review failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
