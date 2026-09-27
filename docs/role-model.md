# Role model — design for caregivers, nurses and doctors

Status as of 27 September 2026: **the nurse/physician split is built, tested
and live. Caregivers are not.**

- Staging database, separate from production — done.
- Access-control tests for the roles that exist — done, 20 of them. The first
  run found a real hole; see `0005_profiles_column_privileges.sql`.
- Nurse/physician split — done: `0006`, `0007`, `src/lib/roles.ts`, and six
  tests that hold the line between reading and deciding.
- `audit_log` — not started.
- Caregivers and `consents` — not started. Both clinical decisions they depend
  on have been made; they are recorded below.

The roles are now `patient`, `nurse`, `physician`, `admin`, plus the legacy
`clinician` value that nothing is written with any more. What follows is the
reasoning, kept because the reasoning outlasts the migration.

## What is missing, and why each one matters

**Nurse and doctor are not the same role.** In a sleep clinic a nurse runs the
intake queue, checks that a patient has answered, and chases missing
measurements. A doctor decides. Today both would share one `clinician` role,
which means a nurse could approve an AI-drafted summary into the medical
record. That is not a permission anyone would grant on purpose.

**A caregiver is not a smaller clinician.** An elderly patient's daughter may
legitimately fill in the questionnaire and read the result — for *her mother*,
and for nobody else. That is access derived from a relationship, not from a
job title, and it needs a different mechanism from the role column.

**Consent must be withdrawable, and the withdrawal must be recorded.** A
caregiver link that cannot be revoked is not consent.

## The seam that already exists

Of the 21 RLS policies in `0001_init.sql`, **13 call one helper function**,
`is_clinician()`. That was written for readability, and it turns out to be the
thing that makes this change tractable: the meaning of "is on the care team"
can be widened in one place instead of in thirteen.

So the nurse/doctor split is mostly additive:

1. Add `nurse` and `physician` to the `user_role` enum. ('physician' rather
   than 'doctor': 'doctor' does not say whether it means a medical
   qualification or a doctorate.)
2. Keep `is_clinician()` meaning **"is on the care team"** — nurse, doctor,
   the legacy `clinician` value, or admin. All 13 existing policies keep
   working unchanged, and existing rows keep their meaning.
3. Add a second helper, `is_physician()`, and use it **only** where a decision is
   being recorded: approving or rejecting an AI summary, and acknowledging a
   safety flag.

Nothing is dropped. The narrowing happens by adding a stricter check to two
specific actions, which can be tested one at a time and reverted one at a
time.

> **Warning, worth stating loudly:** PostgreSQL enum values can be added but
> **not removed**. Renaming one later means creating a new type and migrating
> every column that uses it. The role names must be settled before the
> migration runs once.

## Caregivers: a different shape of rule

Not a role, a relationship. A new table:

```
patient_caregivers
  patient_id     -> profiles
  caregiver_id   -> profiles
  relationship   text        -- 'child', 'spouse', 'other'
  granted_at     timestamptz
  revoked_at     timestamptz  -- null while active
  unique (patient_id, caregiver_id)
```

Access is then "this row exists and `revoked_at is null`", added as an
additional policy alongside the existing patient-owns-their-row policies —
never by loosening those.

Two decisions, both made on 27 September 2026 by the clinician on the project.
Neither is technical; both are recorded here because a migration is a bad
place to discover that nobody had decided.

**Can a caregiver see safety flags? Yes.**

Decided against this document's earlier suggested default of "no, with opt-in".
The reasoning is clinical: the flag this system raises most often is about
falling asleep at the wheel, and the person who can act on that — take the
keys, drive to the appointment, notice it happening again — is the family
member, not the patient. A warning delivered only to the person least able to
observe themselves is a warning delivered nowhere.

What this changes in the build: the caregiver's `select` policy on
`safety_flags` mirrors the patient's, rather than being withheld.

One condition that should travel with this decision, because it is what makes
it defensible to an ethics committee rather than merely convenient: **the
caregiver link itself carries the patient's consent to it.** Granting access is
an act the patient performs, `consents` records what was agreed and when, and
revoking the link revokes the visibility in the same motion. The patient is
therefore never surprised by what a relative can see — they granted exactly
that. Sharing without a recorded, revocable grant is a different thing wearing
the same name, and should not be built.

(A patient who lacks the capacity to grant it is a separate legal path —
guardianship, not consent — and is out of scope until someone who knows Thai
health law has looked at it. Flagging, not advising.)

**Can a caregiver answer on the patient's behalf? Yes.**

What this changes in the build, and it is not small: `intake_responses` needs
`answered_by uuid references public.profiles (id)`, defaulting to the patient.
A STOP-BANG item about observed apnoea answered by the spouse who watched it
happen is *better* evidence than the patient's own guess; an ESS item about
the patient's own likelihood of dozing, answered by a relative, is *worse*.
Same table, same score, different confidence — and a clinician cannot tell
which they are reading unless the row says so.

So the clinician's screen must show it. A score assembled from a mix of
sources without saying so is the same failure as reporting an incomplete
score as if it were complete, which this project already refuses to do
elsewhere.

## What has to exist first

**A separate Supabase project as a staging database.** Today local development
and production share one database. That was an acceptable trade while the
schema was small; it is not acceptable while rewriting access rules, because a
mistake in a policy is not a crash — it is data visible to the wrong person,
silently. The free tier allows a second project, and Vercel Preview
deployments can point at it.

**Tests for the policies themselves.** There are 82 tests for the scoring
rules and zero for access control, which is backwards: a wrong score is
something a clinician notices and questions, while data reaching the wrong
person is noticed by nobody. The suite needed is mechanical — sign in as each
role, assert what is visible and, more importantly, what is not.

## Order — what happened, and what is left

1. ~~Staging database + RLS tests for the roles that exist today.~~ **Done.**
   The safety net was built first, and it caught something on its first run:
   `profiles` had no column privileges, so any patient could set their own
   role to `clinician` and read every patient in the database. The schema had
   claimed otherwise in a comment since day one. This is the whole argument
   for doing step 1 before step 2, and it made it by itself.
2. ~~Nurse/physician split.~~ **Done.** Additive as predicted: `is_clinician()`
   widened in one place, all 13 policies that call it untouched, and
   `is_physician()` added to exactly two actions.
3. `audit_log`. Next. Once several kinds of user can reach the same record,
   "who looked at what, and when" stops being optional.
4. Caregivers plus `consents`, together. Neither makes sense alone. Both
   decisions above are settled, and `intake_responses.answered_by` is the
   schema change they require.
