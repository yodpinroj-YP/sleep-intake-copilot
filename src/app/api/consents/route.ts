import { NextResponse } from "next/server";

import { isConsentPurpose } from "@/lib/consent";
import { createClient } from "@/lib/supabase/server";
import { recordConsent } from "@/services/consent/consent-service";

/**
 * POST /api/consents
 * Body: { purpose: 'care' | 'ai_summary' | 'research', granted: boolean }
 *
 * Records one consent decision for the signed-in patient.
 *
 * There is deliberately no `patientId` in the body. The row is written for
 * whoever is signed in, and the insert policy in 0010 pins both `patient_id`
 * and `recorded_by` to `auth.uid()` — so even a request that tried to name
 * someone else would be refused by the database rather than by this file
 * remembering to check.
 *
 * There is also no PUT or DELETE. Changing your mind is another POST with
 * `granted: false`, which lands as a new row; the table refuses edits.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { purpose?: unknown; granted?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isConsentPurpose(body.purpose)) {
    return NextResponse.json(
      { error: "`purpose` must be 'care', 'ai_summary' or 'research'" },
      { status: 400 }
    );
  }

  // Strict, for the same reason the ISI screening answer is strict: a missing
  // or malformed value must never be read as a decision the patient did not
  // make. Consent is not something to infer from a default.
  if (typeof body.granted !== "boolean") {
    return NextResponse.json(
      { error: "`granted` must be true or false" },
      { status: 400 }
    );
  }

  try {
    await recordConsent(supabase, user.id, body.purpose, body.granted);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record consent";
    console.error("[consent] write failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
