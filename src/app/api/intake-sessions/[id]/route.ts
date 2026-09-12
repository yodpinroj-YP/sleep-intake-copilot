import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteIntakeSession,
  updateIntakeSessionComplaint,
} from "@/services/intake/service";

/**
 * PATCH /api/intake-sessions/[id]
 * Body: { chiefComplaint: string }
 *
 * Lets the signed-in patient edit the chief complaint on their own
 * session. RLS also enforces the ownership + status check at the
 * database level (see supabase/migrations/0001_init.sql).
 */
export async function PATCH(
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

  let body: { chiefComplaint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.chiefComplaint !== "string") {
    return NextResponse.json(
      { error: "`chiefComplaint` (string) is required" },
      { status: 400 }
    );
  }

  try {
    const session = await updateIntakeSessionComplaint(
      supabase,
      user.id,
      id,
      body.chiefComplaint
    );
    return NextResponse.json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/intake-sessions/[id]
 *
 * Lets the signed-in patient delete (abandon) their own session. RLS
 * only allows this while the session is still not_started/in_progress
 * (see supabase/migrations/0002_intake_session_delete_policy.sql).
 */
export async function DELETE(
  _request: Request,
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

  try {
    await deleteIntakeSession(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
