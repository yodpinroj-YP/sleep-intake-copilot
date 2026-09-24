import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateAgeYears } from "@/services/intake/stopbang-scoring.ts";

import { generateText } from "./gemini";
import {
  assertNoIdentifiers,
  buildSummaryInput,
  type SummaryEss,
  type SummaryFlag,
  type SummaryInput,
  type SummaryStopBang,
} from "./summary-input.ts";
import {
  buildUserPrompt,
  parseSummaryDraft,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type SummaryDraft,
} from "./summary-prompt.ts";

/**
 * Generates one AI draft summary for a session and files it for review.
 *
 * THE SHAPE OF THIS, AND WHY
 *
 * Read the deterministic results out of the database → strip identifiers →
 * ask the model → validate what comes back → store it as `pending_review`.
 *
 * Nothing in that chain lets the model touch a score, a risk category or a
 * safety flag. Those are computed by tested rules and are already in the
 * database before this function runs; the model receives them as facts and its
 * only job is to put them into sentences. That separation is what makes an AI
 * feature defensible in a clinical setting: if the model is wrong, it is wrong
 * about the prose, never about the number.
 *
 * The draft is never the record. It lands with status `pending_review` and
 * becomes part of the record only when a clinician approves it, through a
 * different endpoint, with their identity and the time recorded.
 *
 * This uses the service-role client because `clinician_summaries` and
 * `ai_processing_logs` have no INSERT policy for `authenticated` — by design,
 * so that nothing in a browser can write into a clinician's review queue. The
 * caller is therefore responsible for checking that the requester is allowed
 * to do this; see the route.
 */

export class MissingServiceRoleKeyError extends Error {
  constructor() {
    super(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local and restart the dev server."
    );
    this.name = "MissingServiceRoleKeyError";
  }
}

export class NothingToSummariseError extends Error {
  constructor() {
    super(
      "ยังไม่มีคะแนนแบบประเมินสำหรับเคสนี้ — ผู้ป่วยต้องตอบแบบสอบถามอย่างน้อยหนึ่งชุดก่อน"
    );
    this.name = "NothingToSummariseError";
  }
}

export class PendingSummaryExistsError extends Error {
  constructor() {
    super(
      "มีร่างสรุปที่รอการตรวจสอบอยู่แล้วสำหรับเคสนี้ กรุณาอนุมัติหรือปฏิเสธร่างนั้นก่อนสร้างใหม่"
    );
    this.name = "PendingSummaryExistsError";
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Narrows the stored jsonb breakdown without trusting its contents. */
function readBreakdown(value: unknown): {
  breakdown: unknown[];
  answeredCount: number;
  incomplete: boolean;
  maxPossibleScore: number;
} {
  const obj =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    breakdown: Array.isArray(obj.breakdown) ? obj.breakdown : [],
    answeredCount: typeof obj.answeredCount === "number" ? obj.answeredCount : 0,
    incomplete: obj.incomplete === true,
    maxPossibleScore:
      typeof obj.maxPossibleScore === "number" ? obj.maxPossibleScore : 0,
  };
}

async function writeLog(
  admin: AdminClient,
  sessionId: string,
  model: string,
  latencyMs: number,
  status: "success" | "error",
  errorMessage?: string
): Promise<void> {
  // Metadata only — no prompt, no reply, no patient data. The schema comment
  // in 0001_init.sql is explicit that this table is for debugging and
  // monitoring, and that storing prompt text here would need its own retention
  // policy and admin-only access. A log that quietly becomes a second copy of
  // the medical record is a liability, not an audit trail.
  const { error } = await admin.from("ai_processing_logs").insert({
    session_id: sessionId,
    feature: "summarization",
    model,
    latency_ms: latencyMs,
    status,
    error_message: errorMessage?.slice(0, 500) ?? null,
  });

  // A failure to log must not fail the request that was otherwise fine.
  if (error) {
    console.error("[summary] failed to write ai_processing_log:", error.message);
  }
}

export interface GenerateSummaryOutcome {
  summaryId: string;
  version: number;
  draft: SummaryDraft;
  model: string;
  promptVersion: string;
}

export async function generateSummaryForSession(
  sessionId: string
): Promise<GenerateSummaryOutcome> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new MissingServiceRoleKeyError();
  }

  const admin = createAdminClient();

  // --- Gather what the deterministic layer already decided -----------------

  const { data: session, error: sessionError } = await admin
    .from("intake_sessions")
    .select("id, patient_id, bmi, neck_circumference_cm")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(
      `ไม่พบเคสนี้ (${sessionError?.message ?? "no row"})`
    );
  }

  const [profileResult, scoresResult, flagsResult, existingResult] =
    await Promise.all([
      admin
        .from("profiles")
        .select("full_name, date_of_birth, sex")
        .eq("id", session.patient_id)
        .single(),
      admin
        .from("questionnaire_scores")
        .select("instrument, score, risk_category, score_breakdown")
        .eq("session_id", sessionId),
      admin
        .from("safety_flags")
        .select("flag_type, severity, trigger_source")
        .eq("session_id", sessionId),
      admin
        .from("clinician_summaries")
        .select("version, status")
        .eq("session_id", sessionId)
        .order("version", { ascending: false }),
    ]);

  const existing = existingResult.data ?? [];

  // Stacking unreviewed drafts would turn the review queue into a list of
  // near-identical rows and make "has anyone looked at this patient?"
  // unanswerable at a glance.
  if (existing.some((row) => row.status === "pending_review")) {
    throw new PendingSummaryExistsError();
  }

  const scores = scoresResult.data ?? [];
  if (scores.length === 0) {
    throw new NothingToSummariseError();
  }

  const stopBangRow = scores.find((s) => s.instrument === "STOP_BANG");
  const essRow = scores.find((s) => s.instrument === "ESS");

  let stopBang: SummaryStopBang | null = null;
  if (stopBangRow) {
    const meta = readBreakdown(stopBangRow.score_breakdown);
    stopBang = {
      score: Number(stopBangRow.score),
      maxPossibleScore: meta.maxPossibleScore,
      incomplete: meta.incomplete,
      answeredCount: meta.answeredCount,
      riskCategory: stopBangRow.risk_category,
      items: meta.breakdown as SummaryStopBang["items"],
    };
  }

  let ess: SummaryEss | null = null;
  if (essRow) {
    const meta = readBreakdown(essRow.score_breakdown);
    ess = {
      score: Number(essRow.score),
      maxPossibleScore: meta.maxPossibleScore,
      incomplete: meta.incomplete,
      answeredCount: meta.answeredCount,
      severity: essRow.risk_category,
      items: meta.breakdown as SummaryEss["items"],
    };
  }

  const flags: SummaryFlag[] = (flagsResult.data ?? []).map((flag) => ({
    type: flag.flag_type,
    severity: flag.severity,
    reason: flag.trigger_source,
  }));

  const profile = profileResult.data;

  const input: SummaryInput = buildSummaryInput({
    ageYears: calculateAgeYears(profile?.date_of_birth ?? null),
    sex: profile?.sex ?? null,
    bmi: session.bmi,
    neckCircumferenceCm: session.neck_circumference_cm,
    stopBang,
    ess,
    flags,
  });

  // Last line of defence before anything leaves this network. Throws rather
  // than sending — see summary-input.ts for why this exists at all.
  assertNoIdentifiers(input, {
    fullName: profile?.full_name ?? null,
    dateOfBirth: profile?.date_of_birth ?? null,
  });

  // --- Ask the model -------------------------------------------------------

  const startedAt = Date.now();
  let modelName = process.env.GEMINI_MODEL || "unknown";

  let draft: SummaryDraft;

  try {
    const response = await generateText({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      json: true,
      // Measured, not guessed: on a real case the model spent ~1,965 tokens
      // reasoning before writing a word, and a 2,048 ceiling left 67 for the
      // answer — enough to produce half a sentence of truncated JSON. The
      // budget has to cover the thinking AND the reply.
      maxOutputTokens: 8_192,
    });

    modelName = response.model;
    draft = parseSummaryDraft(response.text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await writeLog(admin, sessionId, modelName, Date.now() - startedAt, "error", message);
    throw err;
  }

  const latencyMs = Date.now() - startedAt;

  // --- File it for review --------------------------------------------------
  //
  // Versioned, never overwritten: a regenerated summary must not erase one a
  // clinician already read and acted on. The `unique (session_id, version)`
  // constraint is what makes a concurrent double-click fail loudly instead of
  // silently producing two drafts claiming to be the same version.

  const nextVersion =
    existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;

  const { data: saved, error: saveError } = await admin
    .from("clinician_summaries")
    .insert({
      session_id: sessionId,
      version: nextVersion,
      summary_text: draft.summaryText,
      key_symptoms: draft.keySymptoms,
      important_negatives: draft.importantNegatives,
      missing_information: draft.missingInformation,
      needs_verification: draft.needsVerification,
      model: modelName,
      prompt_version: PROMPT_VERSION,
      // status is left to the column default, which is 'pending_review'.
      // Writing it explicitly here would make it look like a choice this
      // function is free to make differently. It is not.
    })
    .select("id, version")
    .single();

  if (saveError || !saved) {
    await writeLog(
      admin,
      sessionId,
      modelName,
      latencyMs,
      "error",
      saveError?.message ?? "insert returned no row"
    );
    throw new Error(`บันทึกร่างสรุปไม่สำเร็จ: ${saveError?.message ?? "no row"}`);
  }

  await writeLog(admin, sessionId, modelName, latencyMs, "success");

  return {
    summaryId: saved.id,
    version: saved.version,
    draft,
    model: modelName,
    promptVersion: PROMPT_VERSION,
  };
}
