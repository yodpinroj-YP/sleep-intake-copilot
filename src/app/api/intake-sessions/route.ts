import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createIntakeSession } from "@/services/intake/service";

/**
 * POST /api/intake-sessions
 * Starts a new intake session for the signed-in patient.
 *
 * Route handlers stay thin: authenticate, delegate to the service layer,
 * map errors to HTTP responses. Business logic lives in
 * src/services/intake.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = await createIntakeSession(supabase, user.id);
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
