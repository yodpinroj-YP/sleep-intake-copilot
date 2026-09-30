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
import type { SupabaseClient, User } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — see the header of this file.`);
  return value;
}

const URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = requireEnv("RLS_TEST_PASSWORD");

const PATIENT_A = "patient-a@example.com";
const PATIENT_B = "patient-b@example.com";
// Named for the account, not the role it holds: this address was created
// before the nurse/physician split and 0007 converted it to 'physician'.
const PHYSICIAN = "clinician@example.com";
const NURSE = "nurse@example.com";
const TEST_EMAILS = [PATIENT_A, PATIENT_B, PHYSICIAN, NURSE];

/** Never reuses a stored session — each client is exactly one identity. */
function freshClient(key: string): SupabaseClient {
  return createClient(URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Fails loudly rather than letting an undefined id reach a query. */
function idOf(users: User[], email: string): string {
  const found = users.find((u) => u.email === email);
  if (!found) throw new Error(`No account ${email} in this database.`);
  return found.id;
}

async function signIn(email: string): Promise<SupabaseClient> {
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

let admin!: SupabaseClient;
let alice!: SupabaseClient; // patient A
let bob!: SupabaseClient; // patient B
let doctor!: SupabaseClient; // physician
let nurse!: SupabaseClient;
let stranger!: SupabaseClient; // signed in as nobody

let aliceId = "";
let bobId = "";
let nurseId = "";
let aliceSession = "";
let bobSession = "";
/** Still open, so the retraction policy from 0008 applies to it. */
let aliceOpenSession = "";
let aliceOpenResponseId = "";
let aliceClosedResponseId = "";
let aliceSummaryId = "";

describe("Row Level Security", () => {
  before(async () => {
    admin = freshClient(SERVICE);

    // The guard. Staging contains three accounts and nothing else; any other
    // address means this is someone's real database.
    const { data: userList, error: listError } = await admin.auth.admin.listUsers();
    if (listError) throw new Error(`Could not list users: ${listError.message}`);

    const emails = userList.users.map((u) => u.email ?? "");
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

    aliceId = idOf(userList.users, PATIENT_A);
    bobId = idOf(userList.users, PATIENT_B);
    nurseId = idOf(userList.users, NURSE);

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

    aliceSession = sessions!.find((s) => s.patient_id === aliceId)!.id;
    bobSession = sessions!.find((s) => s.patient_id === bobId)!.id;

    // A second session for Alice that is still in progress. 0008 allows an
    // answer to be retracted only while the session is open, so testing that
    // rule needs one of each.
    const { data: openSession, error: openError } = await admin
      .from("intake_sessions")
      .insert({
        patient_id: aliceId,
        status: "in_progress",
        chief_complaint: "RLS test — Alice, open",
      })
      .select("id")
      .single();
    if (openError) throw new Error(`Seeding failed: ${openError.message}`);
    aliceOpenSession = openSession!.id;

    const { data: seededResponses, error: responseError } = await admin
      .from("intake_responses")
      .insert([
        {
          session_id: aliceOpenSession,
          question_key: "ess_watching_tv",
          question_domain: "ess",
          answer_value: 2,
          source: "structured_choice",
        },
        {
          session_id: aliceSession,
          question_key: "ess_watching_tv",
          question_domain: "ess",
          answer_value: 2,
          source: "structured_choice",
        },
      ])
      .select("id, session_id");
    if (responseError) throw new Error(`Seeding failed: ${responseError.message}`);

    aliceOpenResponseId = seededResponses!.find(
      (r) => r.session_id === aliceOpenSession
    )!.id;
    aliceClosedResponseId = seededResponses!.find(
      (r) => r.session_id === aliceSession
    )!.id;

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
    aliceSummaryId = summary!.id;

    await admin.from("ai_processing_logs").insert({
      session_id: aliceSession,
      feature: "summarization",
      model: "rls-test",
      status: "success",
    });

    alice = await signIn(PATIENT_A);
    bob = await signIn(PATIENT_B);
    doctor = await signIn(PHYSICIAN);
    nurse = await signIn(NURSE);
    stranger = freshClient(ANON);

    // The roles these two accounts hold are the subject of half these tests,
    // so assert them rather than assuming the migrations were applied here.
    // A nurse who is still a 'patient' in this database would make the
    // "nurse cannot approve" test pass for entirely the wrong reason.
    const physicianId = idOf(userList.users, PHYSICIAN);
    const roleOf = async (id: string) => {
      const { data } = await admin.from("profiles").select("role").eq("id", id).single();
      return data?.role;
    };
    const physicianRole = await roleOf(physicianId);
    const nurseRole = await roleOf(nurseId);
    if (physicianRole !== "physician") {
      throw new Error(
        `${PHYSICIAN} holds role '${physicianRole}', expected 'physician'. ` +
          "Has 0007 been run against this database?"
      );
    }
    if (nurseRole !== "nurse") {
      throw new Error(`${NURSE} holds role '${nurseRole}', expected 'nurse'.`);
    }
  });

  after(async () => {
    // Cascades clear responses, scores, flags, summaries and logs.
    if (admin && aliceSession && bobSession) {
      await admin
        .from("intake_sessions")
        .delete()
        .in("id", [aliceSession, bobSession, aliceOpenSession].filter(Boolean));
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
    assert.equal(data!.length, 1);
  });

  it("a patient cannot read another patient's intake session", async () => {
    const { data, error } = await bob.from("intake_sessions").select("id").eq("id", aliceSession);
    // RLS filters rather than refuses: the row is invisible, not forbidden.
    // That distinction matters — a 403 would confirm the row exists.
    assert.equal(error, null);
    assert.equal(data!.length, 0);
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
    assert.equal(data!.length, 2);
  });

  it("a patient cannot read another patient's scores", async () => {
    const { data } = await bob
      .from("questionnaire_scores")
      .select("id")
      .eq("session_id", aliceSession);
    assert.equal(data!.length, 0);
  });

  it("a patient cannot read another patient's safety flags", async () => {
    const { data } = await bob.from("safety_flags").select("id").eq("session_id", aliceSession);
    assert.equal(data!.length, 0);
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
    assert.equal(data!.length, 1);
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
    assert.equal(check!.chief_complaint, "RLS test — Alice");
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
    assert.equal(check!.status, "pending_review");
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
    assert.equal(check!.status, "approved");
  });

  // ------------------------------------------------- retracting an answer

  it("a patient can retract their own answer while the session is open", async () => {
    const { error } = await alice
      .from("intake_responses")
      .delete()
      .eq("id", aliceOpenResponseId);
    assert.equal(error, null);

    const { data: check } = await admin
      .from("intake_responses")
      .select("id")
      .eq("id", aliceOpenResponseId);
    assert.equal(
      (check ?? []).length,
      0,
      "Without this, an item can change answers but never return to " +
        "unanswered — a state this system reports differently from a zero."
    );
  });

  it("a patient cannot retract an answer once the session is completed", async () => {
    await alice.from("intake_responses").delete().eq("id", aliceClosedResponseId);

    const { data: check } = await admin
      .from("intake_responses")
      .select("id")
      .eq("id", aliceClosedResponseId);
    assert.equal(
      (check ?? []).length,
      1,
      "A completed session may already have been read by a clinician."
    );
  });

  it("a patient cannot retract another patient's answer", async () => {
    await bob.from("intake_responses").delete().eq("id", aliceClosedResponseId);

    const { data: check } = await admin
      .from("intake_responses")
      .select("id")
      .eq("id", aliceClosedResponseId);
    assert.equal((check ?? []).length, 1);
  });

  // ------------------------------------------- nurse and physician differ

  it("a nurse can read every patient's intake session", async () => {
    const { data } = await nurse
      .from("intake_sessions")
      .select("id")
      .in("id", [aliceSession, bobSession]);
    assert.equal(data!.length, 2, "A nurse runs the intake queue and must see it.");
  });

  it("a nurse can read scores and safety flags", async () => {
    const { data: scores } = await nurse
      .from("questionnaire_scores")
      .select("id")
      .eq("session_id", aliceSession);
    assert.equal(scores!.length, 1);

    const { data: flags } = await nurse
      .from("safety_flags")
      .select("id")
      .eq("session_id", aliceSession);
    assert.equal(flags!.length, 1);
  });

  it("a nurse cannot approve an AI summary", async () => {
    // Seed a second draft: the physician approved version 1 further up.
    const { data: draft } = await admin
      .from("clinician_summaries")
      .insert({
        session_id: aliceSession,
        version: 2,
        summary_text: "RLS test — nurse must not approve this",
        model: "rls-test",
      })
      .select("id")
      .single();

    const { data } = await nurse
      .from("clinician_summaries")
      .update({ status: "approved" })
      .eq("id", draft!.id)
      .select("id");
    assert.equal(data?.length ?? 0, 0);

    const { data: check } = await admin
      .from("clinician_summaries")
      .select("status")
      .eq("id", draft!.id)
      .single();
    assert.equal(
      check!.status,
      "pending_review",
      "A nurse accepted an AI draft into the record. That is the one decision " +
        "the nurse/physician split exists to separate."
    );
  });

  it("a nurse cannot acknowledge a safety flag", async () => {
    const { data: flag } = await admin
      .from("safety_flags")
      .select("id")
      .eq("session_id", aliceSession)
      .single();

    await nurse
      .from("safety_flags")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", flag!.id);

    const { data: check } = await admin
      .from("safety_flags")
      .select("acknowledged_at")
      .eq("id", flag!.id)
      .single();
    assert.equal(check!.acknowledged_at, null);
  });

  it("a physician can acknowledge a safety flag", async () => {
    const { data: flag } = await admin
      .from("safety_flags")
      .select("id")
      .eq("session_id", aliceSession)
      .single();

    const { error } = await doctor
      .from("safety_flags")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", flag!.id);
    assert.equal(error, null);

    const { data: check } = await admin
      .from("safety_flags")
      .select("acknowledged_at")
      .eq("id", flag!.id)
      .single();
    assert.notEqual(check!.acknowledged_at, null);
  });

  it("a nurse cannot promote themselves to physician", async () => {
    await nurse.from("profiles").update({ role: "physician" }).eq("id", nurseId);

    const { data: after } = await admin
      .from("profiles")
      .select("role")
      .eq("id", nurseId)
      .single();

    if (after!.role !== "nurse") {
      await admin.from("profiles").update({ role: "nurse" }).eq("id", nurseId);
    }

    assert.equal(
      after!.role,
      "nurse",
      "The column privileges from 0005 must cover the new roles too — " +
        "a split nobody can cross by editing their own row is the whole point."
    );
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
    if (after!.role !== "patient") {
      await admin.from("profiles").update({ role: "patient" }).eq("id", aliceId);
    }

    assert.equal(
      after!.role,
      "patient",
      "A patient changed their own role. Every policy that calls is_clinician() " +
        "now returns true for them, which means read access to every patient " +
        "in the database."
    );
  });

  // ------------------------------------------------------------- audit log

  /**
   * 0009 closes this table to the application twice over, and these tests are
   * written to notice if either half is undone.
   *
   * First the table-level GRANTs are revoked from `anon` and `authenticated`,
   * so PostgREST refuses the request outright — the error comes back before
   * RLS is consulted at all. Then, underneath that, RLS is enabled with no
   * policy, so even if a later migration re-granted SELECT the rows would
   * still not be returned.
   *
   * The assertions below are therefore on the ROWS, not on the error. A
   * permission error and an empty set are both correct answers to "can this
   * account read the log"; insisting on one of them would make the test fail
   * the day the other becomes true, which is what happened the first time
   * these ran.
   */

  /**
   * Proves the table is actually there before the three tests below claim
   * nobody can read it.
   *
   * Without this, a database where 0009 was never run would pass all of them:
   * PostgREST answers a missing table with an error and no rows, which is
   * indistinguishable from a table that exists and refuses. Three green ticks
   * for a table that does not exist is worse than a red one.
   */
  it("the audit log exists and the service role can read it", async () => {
    const { error } = await admin.from("audit_log").select("id").limit(1);

    assert.equal(
      error,
      null,
      `Service role cannot read audit_log (${error?.message}). If this says ` +
        `the relation does not exist, 0009_audit_log.sql has not been run ` +
        `against this database and the tests below prove nothing.`
    );
  });

  it("a patient cannot read the audit log", async () => {
    const { data, error } = await alice.from("audit_log").select("id").limit(1);

    assert.equal(
      data?.length ?? 0,
      0,
      "A patient can read the audit log. It names every other patient whose " +
        "record was opened, and by whom."
    );

    // Not required to pass, but reported when it does not hold, because the
    // two refusals mean different things and it is worth knowing which one is
    // in force: a permission error means the GRANTs are still revoked.
    if (!error) {
      console.warn(
        "[rls] audit_log returned no error to a patient — the SELECT grant " +
          "appears to have been restored, and only RLS is holding the line."
      );
    }
  });

  it("a nurse cannot read the audit log", async () => {
    const { data } = await nurse.from("audit_log").select("id").limit(1);
    assert.equal(data?.length ?? 0, 0);
  });

  it("a physician cannot read the audit log", async () => {
    // Deliberate, and worth stating plainly: a physician has the widest access
    // in this system to patient data, and none at all to the record of who
    // used it. A log the people it watches can read is a log they can be
    // tempted to argue with.
    const { data } = await doctor.from("audit_log").select("id").limit(1);
    assert.equal(data?.length ?? 0, 0);
  });

  it("nobody can rewrite history, not even the service role", async () => {
    // The triggers in 0009 are what make "append-only" true rather than
    // aspirational. RLS cannot deliver this on its own: the writer here IS
    // the service role, and service role bypasses RLS entirely.
    //
    // This inserts a row of its own rather than reusing whatever happens to be
    // in the table, so the test proves the same thing on an empty database as
    // on a busy one. Writing a fabricated event into an audit log would be
    // indefensible in production; it is fine here only because the guard at
    // the top of this file refuses to run against any database holding an
    // account outside @example.com, which makes every row in it synthetic.
    //
    // The row cannot be cleaned up afterwards. That is not an oversight — it
    // is the property being tested.
    const { data: inserted, error: insertError } = await admin
      .from("audit_log")
      .insert({
        action: "record_viewed",
        actor_id: nurseId,
        actor_role: "nurse",
        patient_id: aliceId,
        session_id: aliceSession,
        entity_table: "intake_sessions",
        entity_id: aliceSession,
        details: { recordCount: 1 },
      })
      .select("id")
      .single();

    assert.equal(
      insertError,
      null,
      `Service role could not write to audit_log (${insertError?.message}). ` +
        `Nothing in this application can record anything.`
    );

    const row = inserted!;

    const { error: updateError } = await admin
      .from("audit_log")
      // The generated types declare `Update: never` for this table precisely
      // because the database refuses it. The cast is here so the test can
      // prove at runtime what the types assert at compile time.
      .update({ action: "record_viewed" } as never)
      .eq("id", row.id);

    const { error: deleteError } = await admin
      .from("audit_log")
      .delete()
      .eq("id", row.id);

    assert.ok(
      updateError,
      "An audit row was updated. A record that can be edited proves nothing."
    );
    assert.ok(
      deleteError,
      "An audit row was deleted. A record that can be removed proves nothing."
    );
  });

  // -------------------------------------------------------------- consents

  /**
   * Consent is the lawful basis for holding any of the data the tests above
   * are protecting, so the rules about who can write it matter as much as the
   * rules about who can read the answers.
   *
   * These rows accumulate in the staging database and cannot be cleaned up.
   * That is the property under test: 0010 refuses UPDATE and DELETE, service
   * role included, because a consent record that can be rewritten cannot show
   * what was agreed on the day the data was collected.
   */

  it("a patient can record their own consent", async () => {
    const { error } = await alice.from("consents").insert({
      patient_id: aliceId,
      purpose: "research",
      granted: true,
      text_version: "rls-test",
      recorded_by: aliceId,
      source: "patient_web",
    });

    assert.equal(
      error,
      null,
      `A patient could not record their own consent (${error?.message}). ` +
        `Nobody can use the system.`
    );
  });

  it("a patient cannot record consent on someone else's behalf", async () => {
    // The insert policy pins patient_id to auth.uid(), so this is refused by
    // the database rather than by the route remembering to check. Consent
    // given by the wrong person is not consent.
    const { error } = await alice.from("consents").insert({
      patient_id: bobId,
      purpose: "research",
      granted: true,
      text_version: "rls-test",
      recorded_by: aliceId,
      source: "patient_web",
    });

    assert.ok(
      error,
      "One patient recorded consent for another. Every row in this table " +
        "would become a claim nobody can trust."
    );
  });

  it("a patient cannot claim someone else pressed the button", async () => {
    // patient_id is their own, but recorded_by is not. Allowing this would let
    // a row say a caregiver or a nurse gave consent when the patient did.
    const { error } = await alice.from("consents").insert({
      patient_id: aliceId,
      purpose: "research",
      granted: true,
      text_version: "rls-test",
      recorded_by: bobId,
      source: "patient_web",
    });

    assert.ok(error, "A consent row was attributed to the wrong person.");
  });

  it("a patient cannot read another patient's consents", async () => {
    const { data } = await alice
      .from("consents")
      .select("id")
      .eq("patient_id", bobId);

    assert.equal(data?.length ?? 0, 0);
  });

  it("the care team can see whether a patient consented", async () => {
    // A clinician needs to know why an AI draft is unavailable for one patient
    // and offered for another. They see the fact, and have no policy that lets
    // them change it.
    const { data, error } = await doctor
      .from("consents")
      .select("id, purpose, granted")
      .eq("patient_id", aliceId);

    assert.equal(error, null);
    assert.ok(
      (data?.length ?? 0) > 0,
      "A physician cannot see the patient's consent, so the interface cannot " +
        "explain why the AI draft is unavailable."
    );
  });

  it("a consent, once recorded, cannot be edited or deleted by anyone", async () => {
    const { data: row, error: insertError } = await admin
      .from("consents")
      .insert({
        patient_id: aliceId,
        purpose: "ai_summary",
        granted: true,
        text_version: "rls-test",
        recorded_by: aliceId,
        source: "staff_entry",
      })
      .select("id")
      .single();

    assert.equal(insertError, null, `Seeding a consent failed: ${insertError?.message}`);

    const { error: updateError } = await admin
      .from("consents")
      .update({ granted: false } as never)
      .eq("id", row!.id);

    const { error: deleteError } = await admin
      .from("consents")
      .delete()
      .eq("id", row!.id);

    assert.ok(
      updateError,
      "A consent row was edited. Withdrawal must be a new row, or the record " +
        "shows only what is true now rather than what was agreed then."
    );
    assert.ok(deleteError, "A consent row was deleted.");
  });

  it("current_consents shows the newest answer and hides other patients", async () => {
    // Withdrawal is an insert, so the view is what turns a pile of rows back
    // into an answer. security_invoker is what stops it handing Bob's answer
    // to Alice.
    await admin.from("consents").insert({
      patient_id: aliceId,
      purpose: "research",
      granted: false,
      text_version: "rls-test",
      recorded_by: aliceId,
      source: "patient_web",
    });

    const { data, error } = await alice
      .from("current_consents")
      .select("patient_id, purpose, granted");

    assert.equal(error, null);

    const research = data?.find((r) => r.purpose === "research");
    assert.equal(
      research?.granted,
      false,
      "The view returned a superseded answer. A withdrawal that does not take " +
        "effect is worse than no withdrawal button at all."
    );
    assert.ok(
      (data ?? []).every((r) => r.patient_id === aliceId),
      "The view leaked another patient's consent, which means security_invoker " +
        "is not in force."
    );
  });
});
