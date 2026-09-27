/**
 * Access-control tests — what each role can and, more importantly, cannot see.
 *
 * These are not unit tests. They sign in as real users against a real
 * Postgres and assert on what comes back, because Row Level Security cannot
 * be tested any other way: the policies are evaluated by the database, not by
 * this codebase, so the only honest test is to ask the database.
 *
 * WHY THESE EXIST AT ALL
 * The scoring rules have 82 tests and access control had none, which is
 * backwards. A wrong score is something a clinician notices and questions.
 * Data reaching the wrong person is noticed by nobody — there is no error, no
 * log line, no symptom. It just quietly happens.
 *
 * WHERE THEY RUN
 * Against the staging project only. The guard in before() refuses to run
 * anywhere that contains a user who is not one of the three @example.com test
 * accounts, because this suite creates and deletes rows. A suite that can be
 * pointed at production by a mistyped environment variable is a liability, not
 * a safety net.
 *
 * They are deliberately NOT part of `npm test`. That suite must stay fast and
 * work offline; this one needs a live database and will fail when staging is
 * asleep. A test suite that fails for environmental reasons trains you to
 * ignore failures, which is worse than having no suite.
 *
 *   npm run test:rls
 *
 * Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY (all pointing at staging) and RLS_TEST_PASSWORD.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.RLS_TEST_PASSWORD;

const PATIENT_A = "patient-a@example.com";
const PATIENT_B = "patient-b@example.com";
const CLINICIAN = "clinician@example.com";
const TEST_EMAILS = [PATIENT_A, PATIENT_B, CLINICIAN];

/** Never reuses a stored session — each client is exactly one identity. */
function freshClient(key) {
  return createClient(URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email) {
  const client = freshClient(ANON);
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    throw new Error(`Could not sign in as ${email}: ${error.message}`);
  }
  return client;
}

let admin;
let alice; // patient A
let bob; // patient B
let doctor;
let stranger; // signed in as nobody

let aliceId;
let bobId;
let aliceSession;
let bobSession;
let aliceSummaryId;

describe("Row Level Security", () => {
  before(async () => {
    for (const [name, value] of [
      ["NEXT_PUBLIC_SUPABASE_URL", URL],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON],
      ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
      ["RLS_TEST_PASSWORD", PASSWORD],
    ]) {
      if (!value) throw new Error(`Missing ${name} — see the header of this file.`);
    }

    admin = freshClient(SERVICE);

    // The guard. Staging contains three accounts and nothing else; any other
    // address means this is someone's real database.
    const { data: userList, error: listError } = await admin.auth.admin.listUsers();
    if (listError) throw new Error(`Could not list users: ${listError.message}`);

    const emails = userList.users.map((u) => u.email);
    const unexpected = emails.filter((e) => !TEST_EMAILS.includes(e));
    if (unexpected.length > 0) {
      throw new Error(
        "REFUSING TO RUN. This database contains accounts that are not the " +
          `three test users: ${unexpected.join(", ")}. These tests create and ` +
          "delete rows, so they only run against the staging project. Check " +
          "NEXT_PUBLIC_SUPABASE_URL in .env.local."
      );
    }
    for (const email of TEST_EMAILS) {
      if (!emails.includes(email)) {
        throw new Error(`Missing test account ${email} in this database.`);
      }
    }

    aliceId = userList.users.find((u) => u.email === PATIENT_A).id;
    bobId = userList.users.find((u) => u.email === PATIENT_B).id;

    // Seed through the service-role client on purpose: questionnaire_scores
    // and safety_flags have no INSERT policy for authenticated at all, so the
    // scoring engine is the only thing that can write them. Seeding as a
    // patient would be testing a path the application does not have.
    const { data: sessions, error: seedError } = await admin
      .from("intake_sessions")
      .insert([
        { patient_id: aliceId, status: "completed", chief_complaint: "RLS test — Alice" },
        { patient_id: bobId, status: "completed", chief_complaint: "RLS test — Bob" },
      ])
      .select("id, patient_id");
    if (seedError) throw new Error(`Seeding failed: ${seedError.message}`);

    aliceSession = sessions.find((s) => s.patient_id === aliceId).id;
    bobSession = sessions.find((s) => s.patient_id === bobId).id;

    await admin.from("questionnaire_scores").insert({
      session_id: aliceSession,
      instrument: "ESS",
      raw_answers: {},
      score: 9,
      risk_category: "mild",
    });

    await admin.from("safety_flags").insert({
      session_id: aliceSession,
      flag_type: "drowsy_driving",
      severity: "urgent",
      trigger_source: "rls-test",
    });

    const { data: summary } = await admin
      .from("clinician_summaries")
      .insert({
        session_id: aliceSession,
        summary_text: "RLS test summary",
        model: "rls-test",
      })
      .select("id")
      .single();
    aliceSummaryId = summary.id;

    await admin.from("ai_processing_logs").insert({
      session_id: aliceSession,
      feature: "summarization",
      model: "rls-test",
      status: "success",
    });

    alice = await signIn(PATIENT_A);
    bob = await signIn(PATIENT_B);
    doctor = await signIn(CLINICIAN);
    stranger = freshClient(ANON);
  });

  after(async () => {
    // Cascades clear responses, scores, flags, summaries and logs.
    if (admin && aliceSession && bobSession) {
      await admin.from("intake_sessions").delete().in("id", [aliceSession, bobSession]);
    }
    // Belt and braces: if the self-promotion test found a hole, the role was
    // already reset there. This is in case the suite aborted mid-way.
    if (admin && aliceId) {
      await admin.from("profiles").update({ role: "patient" }).eq("id", aliceId);
    }
  });

  // -------------------------------------------------------------- reading

  it("a patient can read their own intake session", async () => {
    const { data } = await alice.from("intake_sessions").select("id").eq("id", aliceSession);
    assert.equal(data.length, 1);
  });

  it("a patient cannot read another patient's intake session", async () => {
    const { data, error } = await bob.from("intake_sessions").select("id").eq("id", aliceSession);
    // RLS filters rather than refuses: the row is invisible, not forbidden.
    // That distinction matters — a 403 would confirm the row exists.
    assert.equal(error, null);
    assert.equal(data.length, 0);
  });

  it("a signed-out visitor can read no intake sessions at all", async () => {
    const { data } = await stranger.from("intake_sessions").select("id");
    assert.equal(data?.length ?? 0, 0);
  });

  it("a clinician can read every patient's intake session", async () => {
    const { data } = await doctor
      .from("intake_sessions")
      .select("id")
      .in("id", [aliceSession, bobSession]);
    assert.equal(data.length, 2);
  });

  it("a patient cannot read another patient's scores", async () => {
    const { data } = await bob
      .from("questionnaire_scores")
      .select("id")
      .eq("session_id", aliceSession);
    assert.equal(data.length, 0);
  });

  it("a patient cannot read another patient's safety flags", async () => {
    const { data } = await bob.from("safety_flags").select("id").eq("session_id", aliceSession);
    assert.equal(data.length, 0);
  });

  it("a patient cannot read the AI processing log", async () => {
    const { data } = await alice.from("ai_processing_logs").select("id");
    assert.equal(data?.length ?? 0, 0);
  });

  it("a clinician can read the AI processing log", async () => {
    const { data } = await doctor
      .from("ai_processing_logs")
      .select("id")
      .eq("session_id", aliceSession);
    assert.equal(data.length, 1);
  });

  // -------------------------------------------------------------- writing

  it("a patient cannot modify another patient's session", async () => {
    const { data } = await bob
      .from("intake_sessions")
      .update({ chief_complaint: "tampered" })
      .eq("id", aliceSession)
      .select("id");
    assert.equal(data?.length ?? 0, 0);

    const { data: check } = await admin
      .from("intake_sessions")
      .select("chief_complaint")
      .eq("id", aliceSession)
      .single();
    assert.equal(check.chief_complaint, "RLS test — Alice");
  });

  it("a patient cannot write their own questionnaire score", async () => {
    const { error } = await alice.from("questionnaire_scores").insert({
      session_id: aliceSession,
      instrument: "STOP_BANG",
      raw_answers: {},
      score: 0,
      risk_category: "low",
    });
    // The point of the whole design: a patient cannot lower their own risk.
    assert.notEqual(error, null);
  });

  it("a patient cannot raise a safety flag on their own session", async () => {
    const { error } = await alice.from("safety_flags").insert({
      session_id: aliceSession,
      flag_type: "invented",
      severity: "urgent",
      trigger_source: "patient",
    });
    assert.notEqual(error, null);
  });

  it("a patient cannot approve an AI summary", async () => {
    const { data } = await alice
      .from("clinician_summaries")
      .update({ status: "approved" })
      .eq("id", aliceSummaryId)
      .select("id");
    assert.equal(data?.length ?? 0, 0);

    const { data: check } = await admin
      .from("clinician_summaries")
      .select("status")
      .eq("id", aliceSummaryId)
      .single();
    assert.equal(check.status, "pending_review");
  });

  it("a clinician can approve an AI summary", async () => {
    const { error } = await doctor
      .from("clinician_summaries")
      .update({ status: "approved" })
      .eq("id", aliceSummaryId);
    assert.equal(error, null);

    const { data: check } = await admin
      .from("clinician_summaries")
      .select("status")
      .eq("id", aliceSummaryId)
      .single();
    assert.equal(check.status, "approved");
  });

  // ------------------------------------------------- the one that matters

  it("a patient cannot promote themselves to clinician", async () => {
    await alice.from("profiles").update({ role: "clinician" }).eq("id", aliceId);

    // Read back with the service-role client rather than trusting the
    // response: what the database holds is the only thing that counts.
    const { data: after } = await admin
      .from("profiles")
      .select("role")
      .eq("id", aliceId)
      .single();

    // Undo before asserting, so a failure here cannot leave a patient
    // account holding clinician access in the staging database.
    if (after.role !== "patient") {
      await admin.from("profiles").update({ role: "patient" }).eq("id", aliceId);
    }

    assert.equal(
      after.role,
      "patient",
      "A patient changed their own role. Every policy that calls is_clinician() " +
        "now returns true for them, which means read access to every patient " +
        "in the database."
    );
  });
});
